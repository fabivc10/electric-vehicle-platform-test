import express from 'express';
import type { ActivityLog } from '../core/services/ActivityLog.js';
import type { ChargingService } from '../core/services/ChargingService.js';
import type { CommandService } from '../core/services/CommandService.js';
import type { ConnectionRegistry } from '../core/services/ConnectionRegistry.js';
import type { Logger } from '../shared/logger.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { chargePointsRouter } from './routes/chargePoints.js';
import { transactionsRouter } from './routes/transactions.js';

export interface HttpDeps {
  charging: ChargingService;
  commands: CommandService;
  activity: ActivityLog;
  connections: ConnectionRegistry;
  logger: Logger;
}

export const createHttpApp = (deps: HttpDeps) => {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', connected: deps.connections.ids(), uptimeSec: Math.round(process.uptime()) });
  });
  app.use('/api/charge-points', chargePointsRouter(deps));
  app.use('/api/transactions', transactionsRouter(deps.charging));

  app.use(notFound);
  app.use(errorHandler(deps.logger.child('http')));
  return app;
};
