import type { z } from 'zod';
import { type RawSample, summarizeReading, toReading } from '../common/sampledValues.js';
import { type HandlerRegistry, defineHandler } from '../common/handler.js';
import { authText, bootText, kwhText, readingText, reasonText, statusText } from '../common/humanize.js';
import * as S from './schemas.js';

/** sampledValue de 1.6 (value es string) → formato común. */
const toRawSamples = (meterValues: z.infer<typeof S.MeterValue16>[]): RawSample[] =>
  meterValues.flatMap((mv) =>
    mv.sampledValue
      .filter((sv) => sv.format !== 'SignedData')
      .map((sv) => ({ value: Number(sv.value), measurand: sv.measurand, unit: sv.unit, phase: sv.phase })),
  );

/** Handlers de los mensajes que inicia el Charge Point en OCPP 1.6. */
export const ocpp16Handlers: HandlerRegistry = {
  BootNotification: defineHandler(S.BootNotificationReq, async ({ chargePointId, charging }, p) => {
    const result = await charging.boot(chargePointId, {
      vendor: p.chargePointVendor,
      model: p.chargePointModel,
      serialNumber: p.chargePointSerialNumber ?? p.chargeBoxSerialNumber,
      firmwareVersion: p.firmwareVersion,
    });
    return {
      response: { status: result.status, currentTime: result.currentTime, interval: result.intervalSec },
      summary: result.status,
      message: `${bootText(result.status)} (${p.chargePointVendor} ${p.chargePointModel})`,
      ok: result.status === 'Accepted',
    };
  }),

  Heartbeat: defineHandler(S.HeartbeatReq, async ({ chargePointId, charging }) => ({
    response: { currentTime: await charging.heartbeat(chargePointId) },
    summary: 'OK',
    message: 'Señal de vida del cargador',
  })),

  StatusNotification: defineHandler(S.StatusNotificationReq, async ({ chargePointId, charging }, p) => {
    await charging.connectorStatus(chargePointId, {
      connectorId: p.connectorId,
      status: p.status,
      errorCode: p.errorCode,
      info: p.info,
      timestamp: p.timestamp,
    });
    return {
      response: {},
      summary: p.status,
      message: statusText(p.connectorId, p.status, p.errorCode, p.info),
      ok: p.status !== 'Faulted',
    };
  }),

  Authorize: defineHandler(S.AuthorizeReq, async ({ chargePointId, charging }, p) => {
    const status = await charging.authorize(chargePointId, p.idTag);
    return { response: { idTagInfo: { status } }, summary: status, message: authText(p.idTag, status), ok: status === 'Accepted' };
  }),

  StartTransaction: defineHandler(S.StartTransactionReq, async ({ chargePointId, charging }, p) => {
    // Aun con idTag inválido hay que devolver un transactionId (§4.8): el cargador decide parar.
    const tx = await charging.startTransaction(chargePointId, {
      connectorId: p.connectorId,
      idTag: p.idTag,
      meterStartWh: p.meterStart,
      startedAt: p.timestamp,
    });
    return {
      response: { transactionId: Number(tx.id), idTagInfo: { status: tx.authorization } },
      summary: `#${tx.id}`,
      message: `Comenzó la carga #${tx.id} en el conector ${p.connectorId} (tarjeta ${p.idTag}${tx.authorization === 'Accepted' ? '' : ', no autorizada'})`,
      ok: tx.authorization === 'Accepted',
    };
  }),

  MeterValues: defineHandler(S.MeterValuesReq, async ({ chargePointId, charging }, p) => {
    const reading = toReading(toRawSamples(p.meterValue));
    const last = p.meterValue.at(-1);
    await charging.meterValues(chargePointId, {
      connectorId: p.connectorId,
      transactionId: p.transactionId?.toString(),
      timestamp: last?.timestamp,
      ...reading,
    });
    return { response: {}, summary: summarizeReading(reading), message: readingText(reading) };
  }),

  StopTransaction: defineHandler(S.StopTransactionReq, async ({ chargePointId, charging }, p) => {
    const transactionId = String(p.transactionId);
    if (p.transactionData?.length) {
      const tx = await charging.getTransaction(chargePointId, transactionId);
      await charging.meterValues(chargePointId, {
        connectorId: tx?.connectorId ?? 0,
        transactionId,
        timestamp: p.transactionData.at(-1)?.timestamp,
        ...toReading(toRawSamples(p.transactionData)),
      });
    }
    const stopped = await charging.stopTransaction(chargePointId, {
      transactionId,
      meterStopWh: p.meterStop,
      stoppedAt: p.timestamp,
      reason: p.reason,
    });
    const response = p.idTag
      ? { idTagInfo: { status: await charging.authorize(chargePointId, p.idTag) } }
      : {};
    return {
      response,
      summary: `#${transactionId} · ${p.reason ?? 'Local'}`,
      message: `Terminó la carga #${transactionId}: ${reasonText(p.reason)}${stopped ? ` · ${kwhText(stopped.energyWh)} entregados` : ''}`,
    };
  }),

  DataTransfer: defineHandler(S.DataTransferReq, (_ctx, p) => ({
    response: { status: 'UnknownVendorId' },
    summary: `${p.vendorId} · UnknownVendorId`,
    message: `Mensaje propietario de ${p.vendorId} (no reconocido)`,
    ok: false,
  })),

  DiagnosticsStatusNotification: defineHandler(S.DiagnosticsStatusNotificationReq, (_ctx, p) => ({
    response: {},
    summary: p.status,
    message: `Diagnóstico: ${p.status}`,
  })),

  FirmwareStatusNotification: defineHandler(S.FirmwareStatusNotificationReq, (_ctx, p) => ({
    response: {},
    summary: p.status,
    message: `Actualización de firmware: ${p.status}`,
  })),
};
