/**
 * Simulador de un cargador OCPP 1.6J (DC, CCS2) para desarrollo.
 *
 *   npm run simulate                       # CP-001 contra ws://localhost:3000/ocpp
 *   npm run simulate -- CP-002 ws://host:3000/ocpp
 *
 * Flujo: BootNotification → StatusNotification(Available) → Preparing → Authorize →
 * StartTransaction → Charging → MeterValues cada 5 s (potencia, energía, V, A, SoC, temp).
 * Responde a RemoteStopTransaction / RemoteStartTransaction / Reset / TriggerMessage.
 */
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

const chargePointId = process.argv[2] ?? 'CP-001';
const baseUrl = process.argv[3] ?? 'ws://localhost:3000/ocpp';
const ID_TAG = 'ABC123';
const CONNECTOR = 1;
const MAX_POWER_W = 22_000;
const BATTERY_WH = 75_000;
const METER_INTERVAL_MS = 5_000;

type Pending = { resolve: (p: any) => void; reject: (e: Error) => void };
const pending = new Map<string, Pending>();

let ws: WebSocket;
let heartbeatTimer: NodeJS.Timeout | undefined;
let meterTimer: NodeJS.Timeout | undefined;
let transactionId: number | undefined;
let energyWh = 1_250_000; // lectura acumulada del medidor
let soc = 42;
let temperature = 28;

const log = (...args: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${chargePointId}`, ...args);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

const call = (action: string, payload: Record<string, unknown>): Promise<any> =>
  new Promise((resolve, reject) => {
    const id = randomUUID();
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify([2, id, action, payload]));
    log('→', action);
  });

const status = (connectorId: number, s: string) =>
  call('StatusNotification', { connectorId, errorCode: 'NoError', status: s, timestamp: now() });

const sendMeterValues = async () => {
  if (transactionId === undefined) return;
  const seconds = METER_INTERVAL_MS / 1000;
  // Curva de carga simple: potencia plena hasta 80 % SoC y luego decae.
  const offered = MAX_POWER_W;
  const power = soc < 80 ? offered * (0.82 + Math.random() * 0.04) : offered * Math.max(0.15, (100 - soc) / 25);
  const deltaWh = (power * seconds) / 3600;
  energyWh += deltaWh;
  soc = Math.min(100, soc + (deltaWh / BATTERY_WH) * 100 * 40); // acelerado x40 para la demo
  temperature = Math.min(55, temperature + (Math.random() - 0.35) * 0.6);
  const voltage = 395 + Math.random() * 6;
  const current = power / voltage;

  await call('MeterValues', {
    connectorId: CONNECTOR,
    transactionId,
    meterValue: [
      {
        timestamp: now(),
        sampledValue: [
          { value: energyWh.toFixed(0), measurand: 'Energy.Active.Import.Register', unit: 'Wh', context: 'Sample.Periodic' },
          { value: (power / 1000).toFixed(2), measurand: 'Power.Active.Import', unit: 'kW' },
          { value: (offered / 1000).toFixed(1), measurand: 'Power.Offered', unit: 'kW' },
          { value: voltage.toFixed(1), measurand: 'Voltage', unit: 'V' },
          { value: current.toFixed(1), measurand: 'Current.Import', unit: 'A' },
          { value: soc.toFixed(0), measurand: 'SoC', unit: 'Percent', location: 'EV' },
          { value: temperature.toFixed(1), measurand: 'Temperature', unit: 'Celsius', location: 'Body' },
        ],
      },
    ],
  });

  if (soc >= 100) await stopTransaction('EVDisconnected');
};

const startTransaction = async (idTag: string) => {
  if (transactionId !== undefined) return;
  await status(CONNECTOR, 'Preparing');
  await sleep(1500);
  const auth = await call('Authorize', { idTag });
  if (auth.idTagInfo?.status !== 'Accepted') {
    log('idTag rechazado', auth.idTagInfo?.status);
    await status(CONNECTOR, 'Available');
    return;
  }
  const res = await call('StartTransaction', {
    connectorId: CONNECTOR,
    idTag,
    meterStart: Math.round(energyWh),
    timestamp: now(),
  });
  transactionId = res.transactionId;
  log('transacción', transactionId);
  await status(CONNECTOR, 'Charging');
  await sendMeterValues();
  meterTimer = setInterval(() => void sendMeterValues().catch(() => undefined), METER_INTERVAL_MS);
};

const stopTransaction = async (reason: string) => {
  if (transactionId === undefined) return;
  clearInterval(meterTimer);
  const id = transactionId;
  transactionId = undefined;
  await status(CONNECTOR, 'Finishing');
  await call('StopTransaction', { transactionId: id, meterStop: Math.round(energyWh), timestamp: now(), reason, idTag: ID_TAG });
  await sleep(3000);
  if (soc >= 100) soc = 35 + Math.random() * 20; // "otro vehículo"
  await status(CONNECTOR, 'Available');
};

/** Comandos que llegan del CSMS. */
const onCall = async (id: string, action: string, payload: any) => {
  log('←', action, JSON.stringify(payload));
  const reply = (p: Record<string, unknown>) => ws.send(JSON.stringify([3, id, p]));
  switch (action) {
    case 'RemoteStopTransaction':
      if (payload.transactionId !== transactionId) return reply({ status: 'Rejected' });
      reply({ status: 'Accepted' });
      return stopTransaction('Remote');
    case 'RemoteStartTransaction':
      if (transactionId !== undefined) return reply({ status: 'Rejected' });
      reply({ status: 'Accepted' });
      return startTransaction(payload.idTag ?? ID_TAG);
    case 'Reset':
      reply({ status: 'Accepted' });
      return ws.close();
    case 'TriggerMessage':
      reply({ status: 'Accepted' });
      if (payload.requestedMessage === 'Heartbeat') await call('Heartbeat', {});
      if (payload.requestedMessage === 'MeterValues') await sendMeterValues();
      if (payload.requestedMessage === 'StatusNotification')
        await status(CONNECTOR, transactionId !== undefined ? 'Charging' : 'Available');
      return;
    case 'ChangeAvailability':
    case 'UnlockConnector':
      return reply({ status: action === 'UnlockConnector' ? 'Unlocked' : 'Accepted' });
    default:
      ws.send(JSON.stringify([4, id, 'NotImplemented', `${action} no implementado en el simulador`, {}]));
  }
};

const connect = () => {
  ws = new WebSocket(`${baseUrl}/${chargePointId}`, ['ocpp1.6']);

  ws.on('open', async () => {
    log('conectado, subprotocolo:', ws.protocol);
    const boot = await call('BootNotification', {
      chargePointVendor: 'SimVendor',
      chargePointModel: 'DC-22',
      chargePointSerialNumber: `SN-${chargePointId}`,
      firmwareVersion: '1.0.0-sim',
    });
    log('BootNotification:', boot.status, `interval ${boot.interval}s`);
    if (boot.status !== 'Accepted') return;

    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => void call('Heartbeat', {}).catch(() => undefined), boot.interval * 1000);

    await status(0, 'Available');
    await status(CONNECTOR, 'Available');
    await sleep(3000);
    await startTransaction(ID_TAG);
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    const [type, id] = msg;
    if (type === 2) return void onCall(id, msg[2], msg[3]);
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (type === 3) p.resolve(msg[2]);
    else p.reject(new Error(`${msg[2]}: ${msg[3]}`));
  });

  ws.on('close', () => {
    log('desconectado; reintentando en 5 s');
    clearInterval(heartbeatTimer);
    clearInterval(meterTimer);
    transactionId = undefined;
    setTimeout(connect, 5000);
  });

  ws.on('error', (err) => log('error', err.message));
};

connect();
