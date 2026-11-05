import { z } from 'zod';

/** Esquemas de los .req que envía el Charge Point (OCPP 1.6 ed.2, sección 6). */

/** §2/§7: dateTime en ISO 8601 con zona (p. ej. 2026-11-05T18:20:52Z o con offset). */
const dateTime = z.iso.datetime({ offset: true });
/** §7.15–7.19: CiStringNType (texto ASCII imprimible, largo máximo N). */
const ci = (n: 20 | 25 | 50 | 255 | 500) => z.string().max(n);
const idToken = ci(20);

/** §7.6 */
export const ChargePointErrorCode = z.enum([
  'ConnectorLockFailure', 'EVCommunicationError', 'GroundFailure', 'HighTemperature', 'InternalError',
  'LocalListConflict', 'NoError', 'OtherError', 'OverCurrentFailure', 'OverVoltage', 'PowerMeterFailure',
  'PowerSwitchFailure', 'ReaderFailure', 'ResetFailure', 'UnderVoltage', 'WeakSignal',
]);
/** §7.31 */
const Measurand = z.enum([
  'Current.Export', 'Current.Import', 'Current.Offered', 'Energy.Active.Export.Register', 'Energy.Active.Import.Register',
  'Energy.Reactive.Export.Register', 'Energy.Reactive.Import.Register', 'Energy.Active.Export.Interval',
  'Energy.Active.Import.Interval', 'Energy.Reactive.Export.Interval', 'Energy.Reactive.Import.Interval', 'Frequency',
  'Power.Active.Export', 'Power.Active.Import', 'Power.Factor', 'Power.Offered', 'Power.Reactive.Export',
  'Power.Reactive.Import', 'RPM', 'SoC', 'Temperature', 'Voltage',
]);
/** §7.35 */
const ReadingContext = z.enum([
  'Interruption.Begin', 'Interruption.End', 'Other', 'Sample.Clock', 'Sample.Periodic', 'Transaction.Begin', 'Transaction.End', 'Trigger',
]);
/** §7.34 */
const Phase = z.enum(['L1', 'L2', 'L3', 'N', 'L1-N', 'L2-N', 'L3-N', 'L1-L2', 'L2-L3', 'L3-L1']);
/** §7.30 */
const Location = z.enum(['Body', 'Cable', 'EV', 'Inlet', 'Outlet']);
/** §7.45 */
const UnitOfMeasure = z.enum(['Wh', 'kWh', 'varh', 'kvarh', 'W', 'kW', 'VA', 'kVA', 'var', 'kvar', 'A', 'V', 'Celsius', 'Fahrenheit', 'K', 'Percent']);
/** §7.36 */
const Reason = z.enum([
  'DeAuthorized', 'EmergencyStop', 'EVDisconnected', 'HardReset', 'Local', 'Other', 'PowerLoss', 'Reboot', 'Remote', 'SoftReset', 'UnlockCommand',
]);

export const ChargePointStatus16 = z.enum([
  'Available',
  'Preparing',
  'Charging',
  'SuspendedEVSE',
  'SuspendedEV',
  'Finishing',
  'Reserved',
  'Unavailable',
  'Faulted',
]);

const SampledValue = z.object({
  value: z.string(),
  context: ReadingContext.optional(),
  format: z.enum(['Raw', 'SignedData']).optional(),
  measurand: Measurand.optional(),
  phase: Phase.optional(),
  location: Location.optional(),
  unit: UnitOfMeasure.optional(),
});

export const MeterValue16 = z.object({
  timestamp: dateTime,
  sampledValue: z.array(SampledValue).min(1),
});

export const BootNotificationReq = z.object({
  chargePointVendor: ci(20),
  chargePointModel: ci(20),
  chargePointSerialNumber: ci(25).optional(),
  chargeBoxSerialNumber: ci(25).optional(),
  firmwareVersion: ci(50).optional(),
  iccid: ci(20).optional(),
  imsi: ci(20).optional(),
  meterType: ci(25).optional(),
  meterSerialNumber: ci(25).optional(),
});

export const HeartbeatReq = z.object({});

export const StatusNotificationReq = z.object({
  connectorId: z.number().int().min(0),
  errorCode: ChargePointErrorCode,
  info: ci(50).optional(),
  status: ChargePointStatus16,
  timestamp: dateTime.optional(),
  vendorId: ci(255).optional(),
  vendorErrorCode: ci(50).optional(),
});

export const AuthorizeReq = z.object({ idTag: idToken });

export const StartTransactionReq = z.object({
  connectorId: z.number().int().min(1),
  idTag: idToken,
  meterStart: z.number().int(),
  reservationId: z.number().int().optional(),
  timestamp: dateTime,
});

export const StopTransactionReq = z.object({
  idTag: idToken.optional(),
  meterStop: z.number().int(),
  timestamp: dateTime,
  transactionId: z.number().int(),
  reason: Reason.optional(),
  transactionData: z.array(MeterValue16).optional(),
});

export const MeterValuesReq = z.object({
  connectorId: z.number().int().min(0),
  transactionId: z.number().int().optional(),
  meterValue: z.array(MeterValue16).min(1),
});

export const DataTransferReq = z.object({
  vendorId: ci(255),
  messageId: ci(50).optional(),
  data: z.string().optional(),
});

/** §7.24 */
export const DiagnosticsStatusNotificationReq = z.object({ status: z.enum(['Idle', 'Uploaded', 'UploadFailed', 'Uploading']) });
/** §7.25 */
export const FirmwareStatusNotificationReq = z.object({
  status: z.enum(['Downloaded', 'DownloadFailed', 'Downloading', 'Idle', 'InstallationFailed', 'Installing', 'Installed']),
});
