import { z } from 'zod';

/** dateTime ISO 8601 con zona horaria. */
const dateTime = z.iso.datetime({ offset: true });

/** Esquemas de los mensajes que inicia el Charging Station en OCPP 2.0.1 (válidos también en 2.1). */

const IdToken = z.object({
  idToken: z.string().max(36),
  type: z.string(),
});

const SampledValue = z.object({
  value: z.number(),
  context: z.string().optional(),
  measurand: z.string().optional(),
  phase: z.string().optional(),
  location: z.string().optional(),
  unitOfMeasure: z.object({ unit: z.string().optional(), multiplier: z.number().int().optional() }).optional(),
});

export const MeterValue201 = z.object({
  timestamp: dateTime,
  sampledValue: z.array(SampledValue).min(1),
});

const Evse = z.object({ id: z.number().int().min(0), connectorId: z.number().int().optional() });

export const BootNotificationReq = z.object({
  reason: z.string(),
  chargingStation: z.object({
    model: z.string().max(20),
    vendorName: z.string().max(50),
    serialNumber: z.string().max(25).optional(),
    firmwareVersion: z.string().max(50).optional(),
  }),
});

export const HeartbeatReq = z.object({});

export const ConnectorStatus201 = z.enum(['Available', 'Occupied', 'Reserved', 'Unavailable', 'Faulted']);

export const StatusNotificationReq = z.object({
  timestamp: dateTime,
  connectorStatus: ConnectorStatus201,
  evseId: z.number().int().min(0),
  connectorId: z.number().int().min(0),
});

export const AuthorizeReq = z.object({ idToken: IdToken });

export const ChargingState = z.enum(['Charging', 'EVConnected', 'SuspendedEV', 'SuspendedEVSE', 'Idle']);

export const TransactionEventReq = z.object({
  eventType: z.enum(['Started', 'Updated', 'Ended']),
  timestamp: dateTime,
  triggerReason: z.string(),
  seqNo: z.number().int(),
  offline: z.boolean().optional(),
  transactionInfo: z.object({
    transactionId: z.string().max(36),
    chargingState: ChargingState.optional(),
    stoppedReason: z.string().optional(),
    remoteStartId: z.number().int().optional(),
  }),
  idToken: IdToken.optional(),
  evse: Evse.optional(),
  meterValue: z.array(MeterValue201).optional(),
});

export const MeterValuesReq = z.object({
  evseId: z.number().int().min(0),
  meterValue: z.array(MeterValue201).min(1),
});

export const DataTransferReq = z.object({
  vendorId: z.string(),
  messageId: z.string().optional(),
  data: z.unknown().optional(),
});

/** Notificaciones que solo se acusan (se registran en el panel). */
export const AnyReq = z.record(z.string(), z.unknown());
