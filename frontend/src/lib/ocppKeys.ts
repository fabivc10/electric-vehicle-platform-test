/**
 * Claves estándar de OCPP 1.6 (§9 "Standard Configuration Key Names & Values"): tipo,
 * unidad y accesibilidad según la tabla del PDF. El CSMS la usa para mostrar cada clave
 * con el control adecuado; lo que manda es el `readonly` que reporta el cargador (§7.29).
 */
export type KeyType = 'boolean' | 'integer' | 'CSL' | 'string';

export interface StdKey {
  type: KeyType;
  unit?: string;
  /** Accesibilidad en la spec. "R/RW" = lo decide el fabricante. */
  access: 'R' | 'RW' | 'R/RW';
  required: boolean;
  profile: 'Core' | 'LocalAuthListManagement' | 'Reservation' | 'SmartCharging';
}

const k = (type: KeyType, access: StdKey['access'], required: boolean, unit?: string, profile: StdKey['profile'] = 'Core'): StdKey => ({
  type,
  access,
  required,
  unit,
  profile,
});

export const STANDARD_KEYS_16: Record<string, StdKey> = {
  // 9.1 Core
  AllowOfflineTxForUnknownId: k('boolean', 'RW', false),
  AuthorizationCacheEnabled: k('boolean', 'RW', false),
  AuthorizeRemoteTxRequests: k('boolean', 'R/RW', true),
  BlinkRepeat: k('integer', 'RW', false, 'veces'),
  ClockAlignedDataInterval: k('integer', 'RW', true, 's'),
  ConnectionTimeOut: k('integer', 'RW', true, 's'),
  ConnectorPhaseRotation: k('CSL', 'RW', true),
  ConnectorPhaseRotationMaxLength: k('integer', 'R', false),
  GetConfigurationMaxKeys: k('integer', 'R', true),
  HeartbeatInterval: k('integer', 'RW', true, 's'),
  LightIntensity: k('integer', 'RW', false, '%'),
  LocalAuthorizeOffline: k('boolean', 'RW', true),
  LocalPreAuthorize: k('boolean', 'RW', true),
  MaxEnergyOnInvalidId: k('integer', 'RW', false, 'Wh'),
  MeterValuesAlignedData: k('CSL', 'RW', true),
  MeterValuesAlignedDataMaxLength: k('integer', 'R', false),
  MeterValuesSampledData: k('CSL', 'RW', true),
  MeterValuesSampledDataMaxLength: k('integer', 'R', false),
  MeterValueSampleInterval: k('integer', 'RW', true, 's'),
  MinimumStatusDuration: k('integer', 'RW', false, 's'),
  NumberOfConnectors: k('integer', 'R', true),
  ResetRetries: k('integer', 'RW', true, 'veces'),
  StopTransactionOnEVSideDisconnect: k('boolean', 'RW', true),
  StopTransactionOnInvalidId: k('boolean', 'RW', true),
  StopTxnAlignedData: k('CSL', 'RW', true),
  StopTxnAlignedDataMaxLength: k('integer', 'R', false),
  StopTxnSampledData: k('CSL', 'RW', true),
  StopTxnSampledDataMaxLength: k('integer', 'R', false),
  SupportedFeatureProfiles: k('CSL', 'R', true),
  SupportedFeatureProfilesMaxLength: k('integer', 'R', false),
  TransactionMessageAttempts: k('integer', 'RW', true, 'veces'),
  TransactionMessageRetryInterval: k('integer', 'RW', true, 's'),
  UnlockConnectorOnEVSideDisconnect: k('boolean', 'RW', true),
  WebSocketPingInterval: k('integer', 'RW', false, 's'),
  // 9.2 Local Auth List Management
  LocalAuthListEnabled: k('boolean', 'RW', true, undefined, 'LocalAuthListManagement'),
  LocalAuthListMaxLength: k('integer', 'R', true, undefined, 'LocalAuthListManagement'),
  SendLocalListMaxLength: k('integer', 'R', true, undefined, 'LocalAuthListManagement'),
  // 9.3 Reservation
  ReserveConnectorZeroSupported: k('boolean', 'R', false, undefined, 'Reservation'),
  // 9.4 Smart Charging
  ChargeProfileMaxStackLevel: k('integer', 'R', true, undefined, 'SmartCharging'),
  ChargingScheduleAllowedChargingRateUnit: k('CSL', 'R', true, undefined, 'SmartCharging'),
  ChargingScheduleMaxPeriods: k('integer', 'R', true, undefined, 'SmartCharging'),
  ConnectorSwitch3to1PhaseSupported: k('boolean', 'R', false, undefined, 'SmartCharging'),
  MaxChargingProfilesInstalled: k('integer', 'R', true, undefined, 'SmartCharging'),
};

/** Variables del Device Model 2.x equivalentes (para tipar la vista de 2.x). */
const V201_TYPES: Record<string, Pick<StdKey, 'type' | 'unit'>> = {
  'OCPPCommCtrlr.HeartbeatInterval': { type: 'integer', unit: 's' },
  'OCPPCommCtrlr.MessageAttempts': { type: 'integer', unit: 'veces' },
  'OCPPCommCtrlr.MessageAttemptInterval': { type: 'integer', unit: 's' },
  'AuthCtrlr.AuthorizeRemoteStart': { type: 'boolean' },
  'AuthCtrlr.LocalAuthorizeOffline': { type: 'boolean' },
  'AuthCtrlr.LocalPreAuthorize': { type: 'boolean' },
  'TxCtrlr.EVConnectionTimeOut': { type: 'integer', unit: 's' },
  'TxCtrlr.StopTxOnEVSideDisconnect': { type: 'boolean' },
  'TxCtrlr.StopTxOnInvalidId': { type: 'boolean' },
  'SampledDataCtrlr.TxStartedMeasurands': { type: 'CSL' },
  'SampledDataCtrlr.TxUpdatedMeasurands': { type: 'CSL' },
  'SampledDataCtrlr.TxUpdatedInterval': { type: 'integer', unit: 's' },
  'SampledDataCtrlr.TxEndedMeasurands': { type: 'CSL' },
  'SampledDataCtrlr.TxEndedInterval': { type: 'integer', unit: 's' },
  'AlignedDataCtrlr.Interval': { type: 'integer', unit: 's' },
  'AlignedDataCtrlr.Measurands': { type: 'CSL' },
  'AlignedDataCtrlr.TxEndedMeasurands': { type: 'CSL' },
};

/** Tipo de una clave: tabla §9 (sin distinguir mayúsculas, CiString), 2.x, o deducido del valor. */
export const keyInfo = (key: string, value?: string): Pick<StdKey, 'type' | 'unit'> & Partial<StdKey> => {
  const std = Object.entries(STANDARD_KEYS_16).find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1];
  if (std) return std;
  const v2 = V201_TYPES[key];
  if (v2) return v2;
  if (value === 'true' || value === 'false') return { type: 'boolean' };
  if (value !== undefined && /^\d+$/.test(value)) return { type: 'integer' };
  return { type: 'string' };
};
