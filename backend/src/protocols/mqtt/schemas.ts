import { z } from 'zod';

/**
 * Contrato MQTT propio de la plataforma (MQTT no define mensajes de carga como OCPP).
 * Unidades base del dominio: W, Wh, V, A, °C, %.
 *
 *   {prefix}/{chargePointId}/online                 "1" | "0"  (usar como LWT con retain)
 *   {prefix}/{chargePointId}/up/boot                BootMsg
 *   {prefix}/{chargePointId}/up/heartbeat           {}
 *   {prefix}/{chargePointId}/up/status              StatusMsg
 *   {prefix}/{chargePointId}/up/authorize           AuthorizeMsg     → down/authorize
 *   {prefix}/{chargePointId}/up/transaction/start   StartMsg         → down/transaction/start
 *   {prefix}/{chargePointId}/up/meter               MeterMsg
 *   {prefix}/{chargePointId}/up/transaction/stop    StopMsg
 *   {prefix}/{chargePointId}/cmd/{CommandType}      ChargePointCommand (salida del CSMS)
 *
 * Los mensajes `up/*` pueden traer `requestId`; si viene, se copia en la respuesta `down/*`.
 */
const base = { requestId: z.string().optional() };

export const BootMsg = z.object({
  ...base,
  vendor: z.string().optional(),
  model: z.string().optional(),
  serialNumber: z.string().optional(),
  firmwareVersion: z.string().optional(),
});

export const HeartbeatMsg = z.object({ ...base });

export const StatusMsg = z.object({
  ...base,
  connectorId: z.number().int().min(0),
  status: z.enum([
    'Available',
    'Preparing',
    'Charging',
    'SuspendedEVSE',
    'SuspendedEV',
    'Finishing',
    'Reserved',
    'Unavailable',
    'Faulted',
  ]),
  errorCode: z.string().optional(),
  info: z.string().optional(),
});

export const AuthorizeMsg = z.object({ ...base, idTag: z.string() });

export const StartMsg = z.object({
  ...base,
  connectorId: z.number().int().min(1),
  idTag: z.string(),
  meterStartWh: z.number(),
  timestamp: z.string().optional(),
});

export const MeterMsg = z.object({
  ...base,
  connectorId: z.number().int().min(0),
  transactionId: z.string().optional(),
  timestamp: z.string().optional(),
  powerW: z.number().optional(),
  energyWh: z.number().optional(),
  voltageV: z.number().optional(),
  currentA: z.number().optional(),
  socPercent: z.number().optional(),
  temperatureC: z.number().optional(),
  powerOfferedW: z.number().optional(),
});

export const StopMsg = z.object({
  ...base,
  transactionId: z.string(),
  meterStopWh: z.number().optional(),
  timestamp: z.string().optional(),
  reason: z.string().optional(),
});
