import type { ConnectorStatus } from '@ev/shared';
import type { z } from 'zod';
import { type HandlerRegistry, defineHandler } from '../common/handler.js';
import { type RawSample, summarizeReading, toReading } from '../common/sampledValues.js';
import * as S from './schemas.js';
import { authText, bootText, kwhText, readingText, reasonText, statusText } from '../common/humanize.js';

/** sampledValue de 2.x (valor numérico + unitOfMeasure con multiplicador 10^n) → formato común. */
const toRawSamples = (meterValues: z.infer<typeof S.MeterValue201>[]): RawSample[] =>
  meterValues.flatMap((mv) =>
    mv.sampledValue.map((sv) => ({
      value: sv.value * 10 ** (sv.unitOfMeasure?.multiplier ?? 0),
      measurand: sv.measurand,
      unit: sv.unitOfMeasure?.unit,
      phase: sv.phase,
    })),
  );

/** chargingState de TransactionEvent → estado de conector del dominio. */
const CHARGING_STATE_TO_STATUS: Record<z.infer<typeof S.ChargingState>, ConnectorStatus> = {
  Charging: 'Charging',
  EVConnected: 'Preparing',
  SuspendedEV: 'SuspendedEV',
  SuspendedEVSE: 'SuspendedEVSE',
  Idle: 'Preparing',
};

const OCCUPIED_KEEP = new Set<ConnectorStatus>(['Charging', 'SuspendedEV', 'SuspendedEVSE', 'Finishing']);

const ack = (summaryKey?: string) =>
  defineHandler(S.AnyReq, (_ctx, p) => ({
    response: {},
    summary: summaryKey && typeof p[summaryKey] === 'string' ? (p[summaryKey] as string) : 'OK',
  }));

/**
 * Handlers OCPP 2.0.1. Diferencias clave con 1.6:
 *  - El transactionId lo genera el cargador; Start/Update/Stop llegan como TransactionEvent.
 *  - El estado del conector es más pobre (Occupied); el detalle llega en chargingState.
 *  - Se identifica EVSE + conector; el dominio usa el evseId como connectorId.
 */
export const ocpp201Handlers: HandlerRegistry = {
  BootNotification: defineHandler(S.BootNotificationReq, async ({ chargePointId, charging }, p) => {
    const result = await charging.boot(chargePointId, {
      vendor: p.chargingStation.vendorName,
      model: p.chargingStation.model,
      serialNumber: p.chargingStation.serialNumber,
      firmwareVersion: p.chargingStation.firmwareVersion,
    });
    return {
      response: { status: result.status, currentTime: result.currentTime, interval: result.intervalSec },
      summary: result.status,
      message: `${bootText(result.status)} (${p.chargingStation.vendorName} ${p.chargingStation.model})`,
      ok: result.status === 'Accepted',
    };
  }),

  Heartbeat: defineHandler(S.HeartbeatReq, async ({ chargePointId, charging }) => ({
    response: { currentTime: await charging.heartbeat(chargePointId) },
    summary: 'OK',
    message: 'Señal de vida del cargador',
  })),

  StatusNotification: defineHandler(S.StatusNotificationReq, async ({ chargePointId, charging }, p) => {
    let status: ConnectorStatus;
    if (p.connectorStatus === 'Occupied') {
      const cp = await charging.getChargePoint(chargePointId);
      const current = cp?.connectors.find((c) => c.id === p.evseId)?.status;
      status = current && OCCUPIED_KEEP.has(current) ? current : 'Preparing';
    } else {
      status = p.connectorStatus;
    }
    await charging.connectorStatus(chargePointId, { connectorId: p.evseId, status, timestamp: p.timestamp });
    return {
      response: {},
      summary: p.connectorStatus,
      message: statusText(p.evseId, p.connectorStatus === 'Occupied' ? status : p.connectorStatus),
      ok: p.connectorStatus !== 'Faulted',
    };
  }),

  Authorize: defineHandler(S.AuthorizeReq, async ({ chargePointId, charging }, p) => {
    const status = await charging.authorize(chargePointId, p.idToken.idToken);
    return { response: { idTokenInfo: { status } }, summary: status, message: authText(p.idToken.idToken, status), ok: status === 'Accepted' };
  }),

  TransactionEvent: defineHandler(S.TransactionEventReq, async ({ chargePointId, charging }, p) => {
    const { transactionId, chargingState, stoppedReason } = p.transactionInfo;
    const reading = p.meterValue?.length ? toReading(toRawSamples(p.meterValue)) : {};
    // Started, o un Updated/Ended de una transacción que no conocíamos (p. ej. iniciada offline).
    const tx =
      (await charging.getTransaction(chargePointId, transactionId)) ??
      (await charging.startTransaction(chargePointId, {
        transactionId,
        connectorId: p.evse?.id ?? 1,
        idTag: p.idToken?.idToken ?? '',
        meterStartWh: p.eventType === 'Started' ? reading.energyWh : undefined,
        startedAt: p.timestamp,
      }));

    if (p.idToken && !tx.idTag) await charging.identifyTransaction(chargePointId, transactionId, p.idToken.idToken);

    if (Object.keys(reading).length) {
      await charging.meterValues(chargePointId, {
        connectorId: tx.connectorId,
        transactionId,
        timestamp: p.meterValue?.at(-1)?.timestamp,
        ...reading,
      });
    }

    // Ended siempre es Finishing en el dominio, aunque traiga chargingState (p. ej.
    // EVConnected: el cable sigue puesto). Si se desconecta, llegará StatusNotification Available.
    const status =
      p.eventType === 'Ended' ? 'Finishing' : chargingState ? CHARGING_STATE_TO_STATUS[chargingState] : undefined;
    if (status) {
      await charging.connectorStatus(chargePointId, { connectorId: tx.connectorId, status, timestamp: p.timestamp });
    }

    let stopped: Awaited<ReturnType<typeof charging.stopTransaction>>;
    if (p.eventType === 'Ended') {
      stopped = await charging.stopTransaction(chargePointId, {
        transactionId,
        meterStopWh: reading.energyWh,
        stoppedAt: p.timestamp,
        reason: stoppedReason,
      });
    }

    // idTokenInfo solo se devuelve si el mensaje trae idToken.
    const response = p.idToken
      ? { idTokenInfo: { status: await charging.authorize(chargePointId, p.idToken.idToken) } }
      : {};

    const summary =
      p.eventType === 'Started'
        ? `#${transactionId}`
        : p.eventType === 'Ended'
          ? `#${transactionId} · ${stoppedReason ?? 'Local'}`
          : Object.keys(reading).length
            ? summarizeReading(reading)
            : (chargingState ?? 'Updated');
    const message =
      p.eventType === 'Started'
        ? `Comenzó la carga #${transactionId} en el conector ${tx.connectorId}${p.idToken ? ` (tarjeta ${p.idToken.idToken})` : ''}`
        : p.eventType === 'Ended'
          ? `Terminó la carga #${transactionId}: ${reasonText(stoppedReason)}${stopped ? ` · ${kwhText(stopped.energyWh)} entregados` : ''}`
          : Object.keys(reading).length
            ? readingText(reading)
            : chargingState
              ? statusText(tx.connectorId, CHARGING_STATE_TO_STATUS[chargingState])
              : `Carga #${transactionId} actualizada`;
    return { response, summary: `${p.eventType} ${summary}`, message: p.offline ? `${message} (enviado sin conexión)` : message };
  }),

  MeterValues: defineHandler(S.MeterValuesReq, async ({ chargePointId, charging }, p) => {
    const reading = toReading(toRawSamples(p.meterValue));
    await charging.meterValues(chargePointId, {
      connectorId: p.evseId,
      timestamp: p.meterValue.at(-1)?.timestamp,
      ...reading,
    });
    return { response: {}, summary: summarizeReading(reading), message: readingText(reading) };
  }),

  DataTransfer: defineHandler(S.DataTransferReq, (_ctx, p) => ({
    response: { status: 'UnknownVendorId' },
    summary: `${p.vendorId} · UnknownVendorId`,
    ok: false,
  })),

  NotifyEvent: ack(),
  NotifyReport: ack(),
  SecurityEventNotification: ack('type'),
  FirmwareStatusNotification: ack('status'),
  LogStatusNotification: ack('status'),
};
