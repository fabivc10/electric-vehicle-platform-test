import { createServer } from 'node:http';
import { loadConfig } from './config/env.js';
import { AcceptAllAuthorization, LocalListAuthorization } from './core/auth/AuthorizationStrategy.js';
import { EventBus } from './core/events/EventBus.js';
import { ActivityLog } from './core/services/ActivityLog.js';
import { ChargingService } from './core/services/ChargingService.js';
import { CommandService } from './core/services/CommandService.js';
import { ConnectionRegistry } from './core/services/ConnectionRegistry.js';
import { createHttpApp } from './http/app.js';
import { MemoryActivityRepository } from './infrastructure/persistence/memory/MemoryActivityRepository.js';
import { MemoryChargePointRepository } from './infrastructure/persistence/memory/MemoryChargePointRepository.js';
import { MemoryMeterRepository } from './infrastructure/persistence/memory/MemoryMeterRepository.js';
import { MemorySequenceGenerator } from './infrastructure/persistence/memory/MemorySequenceGenerator.js';
import { MemoryTransactionRepository } from './infrastructure/persistence/memory/MemoryTransactionRepository.js';
import { LiveGateway } from './live/LiveGateway.js';
import { MqttGateway } from './protocols/mqtt/MqttGateway.js';
import { OcppGateway } from './protocols/ocpp/OcppGateway.js';
import type { ProtocolGateway } from './protocols/ProtocolGateway.js';
import { createLogger } from './shared/logger.js';

/**
 * Composition root: el ÚNICO lugar donde se eligen implementaciones concretas
 * (persistencia, política de autorización, protocolos habilitados) y se cablean
 * las dependencias. Cambiar de memoria a Postgres = cambiar las líneas de repos aquí.
 */
const config = loadConfig();
const logger = createLogger(config.logLevel);

// Infraestructura
const repos = {
  chargePoints: new MemoryChargePointRepository(),
  transactions: new MemoryTransactionRepository(),
  meters: new MemoryMeterRepository(config.retention.meterSamplesPerChargePoint),
  activity: new MemoryActivityRepository(config.retention.activityPerChargePoint),
  sequence: new MemorySequenceGenerator(config.ocpp.transactionIdStart),
};

// Núcleo
const bus = new EventBus();
const authorization =
  config.auth.policy === 'local-list' ? new LocalListAuthorization(config.auth.idTags) : new AcceptAllAuthorization();
const charging = new ChargingService({
  ...repos,
  authorization,
  bus,
  options: {
    heartbeatIntervalSec: config.ocpp.heartbeatIntervalSec,
    bootPolicy: config.ocpp.bootPolicy,
    knownChargePoints: config.ocpp.knownChargePoints,
  },
});
const activity = new ActivityLog(repos.activity, bus);
const connections = new ConnectionRegistry();
const commands = new CommandService(connections, charging);

// Adaptadores de entrada
const ocpp = new OcppGateway({
  charging,
  activity,
  connections,
  logger: logger.child('ocpp'),
  defaultProtocol: config.ocpp.defaultProtocol,
  callTimeoutMs: config.ocpp.callTimeoutMs,
});
const gateways: ProtocolGateway[] = [ocpp];
if (config.mqtt.url) {
  gateways.push(
    new MqttGateway({
      url: config.mqtt.url,
      topicPrefix: config.mqtt.topicPrefix,
      username: config.mqtt.username,
      password: config.mqtt.password,
      charging,
      activity,
      connections,
      logger: logger.child('mqtt'),
    }),
  );
}
const live = new LiveGateway(bus, logger.child('live'));

// HTTP + upgrades WebSocket en el mismo puerto
const app = createHttpApp({ charging, commands, activity, connections, logger });
const server = createServer(app);
const upgradeHandlers = [ocpp, live];

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  const handler = upgradeHandlers.find((h) => h.matches(pathname));
  if (handler) handler.handleUpgrade(req, socket, head);
  else socket.destroy();
});

const start = async () => {
  for (const gateway of gateways) {
    try {
      await gateway.start();
    } catch (error) {
      logger.error(`No se pudo iniciar el gateway ${gateway.name}`, error);
    }
  }
  live.start();
  server.listen(config.port, () => {
    logger.info(`HTTP   http://localhost:${config.port}/api`);
    logger.info(`OCPP   ws://localhost:${config.port}/ocpp/{chargePointId}  (ocpp1.6 | ocpp2.0.1 | ocpp2.1)`);
    logger.info(`Live   ws://localhost:${config.port}/live`);
  });
};

const shutdown = async (signal: string) => {
  logger.info(`${signal} recibido, cerrando...`);
  live.stop();
  await Promise.allSettled(gateways.map((g) => g.stop()));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

void start();
