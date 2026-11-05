import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../core/errors.js';
import type { ActivityLog } from '../../core/services/ActivityLog.js';
import type { ChargingService } from '../../core/services/ChargingService.js';
import type { CommandService } from '../../core/services/CommandService.js';

const iso = z.iso.datetime({ offset: true });
const Purpose = z.enum(['ChargePointMaxProfile', 'TxDefaultProfile', 'TxProfile']);
/** §7.8 / §7.13 / §7.14 */
const ChargingProfile = z.object({
  id: z.number().int(),
  stackLevel: z.number().int().min(0),
  purpose: Purpose,
  kind: z.enum(['Absolute', 'Recurring', 'Relative']),
  recurrencyKind: z.enum(['Daily', 'Weekly']).optional(),
  validFrom: iso.optional(),
  validTo: iso.optional(),
  transactionId: z.string().optional(),
  schedule: z.object({
    duration: z.number().int().min(0).optional(),
    startSchedule: iso.optional(),
    unit: z.enum(['A', 'W']),
    periods: z
      .array(z.object({ startPeriod: z.number().int().min(0), limit: z.number().min(0), numberPhases: z.number().int().min(1).max(3).optional() }))
      .min(1),
    minChargingRate: z.number().min(0).optional(),
  }),
});

const CommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('RemoteStart'), connectorId: z.number().int().min(1), idTag: z.string().min(1).max(36) }),
  z.object({ type: z.literal('RemoteStop'), transactionId: z.string().min(1) }),
  z.object({ type: z.literal('Reset'), mode: z.enum(['Soft', 'Hard']) }),
  z.object({ type: z.literal('UnlockConnector'), connectorId: z.number().int().min(1) }),
  z.object({ type: z.literal('ChangeAvailability'), connectorId: z.number().int().min(0), available: z.boolean() }),
  z.object({
    type: z.literal('TriggerMessage'),
    message: z.enum(['BootNotification', 'Heartbeat', 'StatusNotification', 'MeterValues']),
    connectorId: z.number().int().min(0).optional(),
  }),
  z.object({ type: z.literal('GetConfiguration'), keys: z.array(z.string().min(1).max(100)).max(50).optional() }),
  z.object({ type: z.literal('ChangeConfiguration'), key: z.string().min(1).max(100), value: z.string().max(500) }),
  z.object({ type: z.literal('SetChargingProfile'), connectorId: z.number().int().min(0), profile: ChargingProfile }),
  z.object({
    type: z.literal('ClearChargingProfile'),
    id: z.number().int().optional(),
    connectorId: z.number().int().min(0).optional(),
    purpose: Purpose.optional(),
    stackLevel: z.number().int().min(0).optional(),
  }),
  z.object({ type: z.literal('GetCompositeSchedule'), connectorId: z.number().int().min(0), duration: z.number().int().min(1), unit: z.enum(['A', 'W']).optional() }),
  z.object({ type: z.literal('Raw'), action: z.string().min(1), payload: z.record(z.string(), z.unknown()) }),
]);

const PatchSchema = z.object({ name: z.string().min(1).max(80) });
const Limit = z.coerce.number().int().min(1).max(1000).default(50);

export const chargePointsRouter = (deps: {
  charging: ChargingService;
  commands: CommandService;
  activity: ActivityLog;
}) => {
  const { charging, commands, activity } = deps;
  const router = Router();

  const mustExist = async (id: string) => {
    const cp = await charging.getChargePoint(id);
    if (!cp) throw new AppError(404, 'CHARGE_POINT_NOT_FOUND', `Cargador ${id} no encontrado`);
    return cp;
  };

  router.get('/', async (_req, res) => {
    res.json(await charging.listChargePoints());
  });

  router.get('/:id', async (req, res) => {
    const snapshot = await charging.snapshot(req.params.id);
    if (!snapshot) throw new AppError(404, 'CHARGE_POINT_NOT_FOUND', `Cargador ${req.params.id} no encontrado`);
    res.json(snapshot);
  });

  router.patch('/:id', async (req, res) => {
    const { name } = PatchSchema.parse(req.body);
    await mustExist(req.params.id);
    res.json(await charging.rename(req.params.id, name));
  });

  router.delete('/:id', async (req, res) => {
    const result = await charging.forget(req.params.id);
    if (result === 'not-found') throw new AppError(404, 'CHARGE_POINT_NOT_FOUND', `Cargador ${req.params.id} no encontrado`);
    if (result === 'online') throw new AppError(409, 'CHARGE_POINT_ONLINE', 'Solo se pueden borrar cargadores desconectados');
    res.status(204).end();
  });

  router.get('/:id/activity', async (req, res) => {
    await mustExist(req.params.id);
    res.json(await activity.list(req.params.id, Limit.parse(req.query.limit)));
  });

  router.get('/:id/meter-values', async (req, res) => {
    await mustExist(req.params.id);
    res.json(await charging.meterHistory(req.params.id, Limit.parse(req.query.limit)));
  });

  router.post('/:id/commands', async (req, res) => {
    const command = CommandSchema.parse(req.body);
    res.json(await commands.execute(req.params.id, command));
  });

  return router;
};
