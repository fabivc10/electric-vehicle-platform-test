import { isSupportedMeasurand } from './measurands';
import type { ChargerType, ConfigEntryView, EmuProtocol } from './types';

type Kind = 'int' | 'bool' | 'measurands' | 'phaseRotation' | 'string';

interface KeyDef {
  /** Nombre OCPP 1.6 (§9.1). Es también el nombre canónico interno. */
  key: string;
  /** Equivalente en el Device Model de 2.0.1/2.1: "Componente.Variable". */
  v201?: string;
  only?: '1.6' | '2.x';
  kind: Kind;
  readonly: boolean;
  initial: (type: ChargerType) => string;
  /** Clave que limita la cantidad de elementos de una CSL (§5.3). */
  maxLengthKey?: string;
  description: string;
}

const MEASURAND_MAX = '10';

/**
 * Valores de fábrica de MeterValuesSampledData. La spec no fija el valor inicial (lo elige
 * el fabricante); se usa el conjunto típico de un equipo real para que el CSMS vea potencia,
 * tensión y corriente. SoC solo existe en DC. El CSMS puede cambiarlo con ChangeConfiguration.
 */
const DEFAULT_SAMPLED = (t: ChargerType) =>
  ['Energy.Active.Import.Register', 'Power.Active.Import', 'Power.Offered', 'Current.Import', 'Voltage', 'Temperature', ...(t === 'DC' ? ['SoC'] : [])].join(',');

/**
 * Claves de configuración del perfil Core (OCPP 1.6 §9.1) que el emulador implementa,
 * con su variable equivalente del Device Model de 2.x. Son las que gobiernan QUÉ se
 * envía y CUÁNDO; el CSMS las lee/cambia con GetConfiguration/ChangeConfiguration
 * (1.6) o GetVariables/SetVariables (2.x).
 */
const KEYS: KeyDef[] = [
  { key: 'AuthorizeRemoteTxRequests', v201: 'AuthCtrlr.AuthorizeRemoteStart', kind: 'bool', readonly: false, initial: () => 'false', description: 'Autorizar (Authorize.req) un inicio remoto como si fuera local' },
  { key: 'LocalAuthorizeOffline', v201: 'AuthCtrlr.LocalAuthorizeOffline', kind: 'bool', readonly: false, initial: () => 'false', description: 'Iniciar offline con identificadores autorizados localmente (RW §9.1.12; sin lista local ni caché no hay ninguno)' },
  { key: 'LocalPreAuthorize', v201: 'AuthCtrlr.LocalPreAuthorize', kind: 'bool', readonly: false, initial: () => 'false', description: 'Iniciar sin esperar Authorize.conf con identificadores locales (RW §9.1.13; sin lista local ni caché no hay ninguno)' },
  { key: 'ClockAlignedDataInterval', v201: 'AlignedDataCtrlr.Interval', kind: 'int', readonly: false, initial: () => '0', description: 'Intervalo (s) alineado a medianoche para MeterValues Sample.Clock. 0 = desactivado' },
  { key: 'MeterValuesAlignedData', v201: 'AlignedDataCtrlr.Measurands', kind: 'measurands', readonly: false, maxLengthKey: 'MeterValuesAlignedDataMaxLength', initial: () => 'Energy.Active.Import.Register', description: 'Measurands de los MeterValues alineados al reloj' },
  { key: 'MeterValuesAlignedDataMaxLength', only: '1.6', kind: 'int', readonly: true, initial: () => MEASURAND_MAX, description: 'Máximo de elementos de MeterValuesAlignedData' },
  { key: 'StopTxnAlignedData', v201: 'AlignedDataCtrlr.TxEndedMeasurands', kind: 'measurands', readonly: false, maxLengthKey: 'StopTxnAlignedDataMaxLength', initial: () => '', description: 'Measurands alineados al reloj dentro de transactionData del StopTransaction' },
  { key: 'StopTxnAlignedDataMaxLength', only: '1.6', kind: 'int', readonly: true, initial: () => MEASURAND_MAX, description: 'Máximo de elementos de StopTxnAlignedData' },
  { key: 'MeterValuesSampledData', v201: 'SampledDataCtrlr.TxUpdatedMeasurands', kind: 'measurands', readonly: false, maxLengthKey: 'MeterValuesSampledDataMaxLength', initial: DEFAULT_SAMPLED, description: 'Measurands de los MeterValues periódicos durante la transacción' },
  { key: 'MeterValuesSampledDataMaxLength', only: '1.6', kind: 'int', readonly: true, initial: () => MEASURAND_MAX, description: 'Máximo de elementos de MeterValuesSampledData' },
  { key: 'MeterValueSampleInterval', v201: 'SampledDataCtrlr.TxUpdatedInterval', kind: 'int', readonly: false, initial: () => '10', description: 'Segundos entre muestras desde el inicio de la transacción. 0 = no enviar' },
  { key: 'TxStartedMeasurands', v201: 'SampledDataCtrlr.TxStartedMeasurands', only: '2.x', kind: 'measurands', readonly: false, initial: () => 'Energy.Active.Import.Register', description: 'Measurands del TransactionEvent Started (Transaction.Begin)' },
  { key: 'StopTxnSampledData', v201: 'SampledDataCtrlr.TxEndedMeasurands', kind: 'measurands', readonly: false, maxLengthKey: 'StopTxnSampledDataMaxLength', initial: () => '', description: 'Measurands muestreados dentro de transactionData del StopTransaction (vacío = ninguno)' },
  { key: 'StopTxnSampledDataMaxLength', only: '1.6', kind: 'int', readonly: true, initial: () => MEASURAND_MAX, description: 'Máximo de elementos de StopTxnSampledData' },
  { key: 'TxEndedInterval', v201: 'SampledDataCtrlr.TxEndedInterval', only: '2.x', kind: 'int', readonly: false, initial: () => '0', description: 'Segundos entre muestras TxEnded durante la transacción. 0 = solo inicio y fin' },
  { key: 'ConnectionTimeOut', v201: 'TxCtrlr.EVConnectionTimeOut', kind: 'int', readonly: false, initial: () => '60', description: 'Segundos en Preparing esperando el cable antes de cancelar la autorización' },
  { key: 'StopTransactionOnEVSideDisconnect', v201: 'TxCtrlr.StopTxOnEVSideDisconnect', kind: 'bool', readonly: false, initial: () => 'true', description: 'Detener la transacción al desconectar el cable del lado del EV' },
  { key: 'StopTransactionOnInvalidId', v201: 'TxCtrlr.StopTxOnInvalidId', kind: 'bool', readonly: false, initial: () => 'true', description: 'Detener si el CSMS no acepta el idTag en StartTransaction.conf' },
  { key: 'UnlockConnectorOnEVSideDisconnect', only: '1.6', kind: 'bool', readonly: false, initial: () => 'true', description: 'Desbloquear el conector al desconectar del lado del EV' },
  { key: 'HeartbeatInterval', v201: 'OCPPCommCtrlr.HeartbeatInterval', kind: 'int', readonly: false, initial: () => '0', description: 'Segundos de inactividad tras los que se envía Heartbeat (lo fija el BootNotification.conf)' },
  { key: 'TransactionMessageAttempts', v201: 'OCPPCommCtrlr.MessageAttempts', kind: 'int', readonly: false, initial: () => '3', description: 'Intentos por mensaje de transacción que el CSMS no procesa' },
  { key: 'TransactionMessageRetryInterval', v201: 'OCPPCommCtrlr.MessageAttemptInterval', kind: 'int', readonly: false, initial: () => '60', description: 'Espera (s) × n.º de intento antes de reenviar' },
  { key: 'GetConfigurationMaxKeys', only: '1.6', kind: 'int', readonly: true, initial: () => '50', description: 'Máximo de claves por GetConfiguration.req' },
  { key: 'NumberOfConnectors', only: '1.6', kind: 'int', readonly: true, initial: () => '1', description: 'Conectores físicos' },
  { key: 'ConnectorPhaseRotation', only: '1.6', kind: 'phaseRotation', readonly: false, maxLengthKey: 'ConnectorPhaseRotationMaxLength', initial: (t) => (t === 'DC' ? '1.NotApplicable' : '1.Unknown'), description: 'CSL «conector.rotación» (§9.1.7): NotApplicable (DC/monofásico), Unknown, RST, RTS, SRT, STR, TRS, TSR' },
  { key: 'ConnectorPhaseRotationMaxLength', only: '1.6', kind: 'int', readonly: true, initial: () => '2', description: 'Máximo de elementos de ConnectorPhaseRotation (conector 0 = red, 1)' },
  { key: 'ResetRetries', only: '1.6', kind: 'int', readonly: false, initial: () => '1', description: 'Reintentos de un reset fallido' },
  { key: 'SupportedFeatureProfiles', only: '1.6', kind: 'string', readonly: true, initial: () => 'Core,RemoteTrigger,SmartCharging', description: 'Perfiles soportados (§9.1.29)' },
  // §9.4 Smart Charging (todas de solo lectura: capacidades del equipo)
  { key: 'ChargeProfileMaxStackLevel', only: '1.6', kind: 'int', readonly: true, initial: () => '5', description: 'stackLevel máximo de un ChargingProfile' },
  { key: 'ChargingScheduleAllowedChargingRateUnit', only: '1.6', kind: 'string', readonly: true, initial: () => 'Current,Power', description: 'Unidades admitidas en chargingRateUnit (Current = A, Power = W)' },
  { key: 'ChargingScheduleMaxPeriods', only: '1.6', kind: 'int', readonly: true, initial: () => '24', description: 'Máximo de chargingSchedulePeriod por perfil' },
  { key: 'MaxChargingProfilesInstalled', only: '1.6', kind: 'int', readonly: true, initial: () => '10', description: 'Máximo de perfiles instalados' },
];

const CSL_KEYS = new Set(['SupportedFeatureProfiles', 'ChargingScheduleAllowedChargingRateUnit']);

const UNITS: Record<string, string> = {
  ClockAlignedDataInterval: 's',
  ConnectionTimeOut: 's',
  HeartbeatInterval: 's',
  MeterValueSampleInterval: 's',
  TxEndedInterval: 's',
  TransactionMessageRetryInterval: 's',
  TransactionMessageAttempts: 'veces',
  ResetRetries: 'veces',
};

const appliesTo = (def: KeyDef, protocol: EmuProtocol) =>
  protocol === 'ocpp1.6' ? def.only !== '2.x' : def.only !== '1.6' && Boolean(def.v201);

export const nameFor = (def: KeyDef, protocol: EmuProtocol) => (protocol === 'ocpp1.6' ? def.key : def.v201!);

export type ChangeStatus = 'Accepted' | 'Rejected' | 'NotSupported';

/** Almacén de configuración del cargador: sobrevive a reinicios (como la memoria no volátil). */
export class ConfigStore {
  private readonly values = new Map<string, { value: string; changedBy?: 'CSMS' | 'local' }>();

  constructor(private type: ChargerType) {
    for (const def of KEYS) this.values.set(def.key, { value: def.initial(type) });
  }

  /** Al cambiar AC/DC se quitan los measurands que el nuevo tipo no puede medir. */
  setChargerType(type: ChargerType) {
    this.type = type;
    for (const def of KEYS) {
      const current = this.values.get(def.key)!;
      // Lo que nadie cambió vuelve al valor de fábrica del nuevo tipo (p. ej. SoC al pasar a DC).
      if ((def.kind === 'phaseRotation' || def.kind === 'measurands') && !current.changedBy) {
        this.values.set(def.key, { value: def.initial(type) });
        continue;
      }
      if (def.kind !== 'measurands') continue;
      const kept = this.list(def.key).filter((m) => isSupportedMeasurand(type, m));
      this.values.set(def.key, { ...this.values.get(def.key)!, value: kept.join(',') });
    }
  }

  get(key: string): string {
    return this.values.get(key)?.value ?? '';
  }
  int(key: string): number {
    return Number.parseInt(this.get(key), 10) || 0;
  }
  bool(key: string): boolean {
    return this.get(key).toLowerCase() === 'true';
  }
  list(key: string): string[] {
    return this.get(key)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** Valor fijado por el propio cargador (p. ej. HeartbeatInterval del BootNotification.conf). */
  setInternal(key: string, value: string) {
    this.values.set(key, { value });
  }

  find(protocol: EmuProtocol, name: string): KeyDef | undefined {
    return KEYS.find((d) => appliesTo(d, protocol) && nameFor(d, protocol).toLowerCase() === name.toLowerCase());
  }

  entries(protocol: EmuProtocol): ConfigEntryView[] {
    return KEYS.filter((d) => appliesTo(d, protocol)).map((d) => ({
      key: d.key,
      name: nameFor(d, protocol),
      value: this.get(d.key),
      readonly: d.readonly,
      type: d.kind === 'bool' ? 'boolean' : d.kind === 'int' ? 'integer' : d.kind === 'string' && !CSL_KEYS.has(d.key) ? 'string' : 'CSL',
      unit: UNITS[d.key],
      changedBy: this.values.get(d.key)?.changedBy,
      description: d.description,
    }));
  }

  /** ChangeConfiguration / SetVariables con las reglas de §5.3 y §3.16.4. */
  change(protocol: EmuProtocol, name: string, raw: string, by: 'CSMS' | 'local'): ChangeStatus {
    const def = this.find(protocol, name);
    if (!def) return 'NotSupported';
    if (def.readonly) return 'Rejected';
    const value = this.validate(def, raw);
    if (value === undefined) return 'Rejected';
    this.values.set(def.key, { value, changedBy: by });
    return 'Accepted';
  }

  private validate(def: KeyDef, raw: string): string | undefined {
    const v = raw.trim();
    switch (def.kind) {
      case 'int':
        return /^\d+$/.test(v) ? String(Number(v)) : undefined;
      case 'bool':
        return /^(true|false)$/i.test(v) ? v.toLowerCase() : undefined;
      case 'measurands': {
        const items = v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (items.some((m) => !isSupportedMeasurand(this.type, m))) return undefined;
        const max = def.maxLengthKey ? this.int(def.maxLengthKey) : Number(MEASURAND_MAX); // 2.x: sin clave MaxLength
        if (items.length > max) return undefined;
        return items.join(',');
      }
      case 'phaseRotation': {
        // Formato «0.RST, 1.RST»; conectores 0 (red ↔ medidor) y 1.
        const items = v.split(',').map((s) => s.trim()).filter(Boolean);
        const ok = items.every((it) => /^[01]\.(NotApplicable|Unknown|RST|RTS|SRT|STR|TRS|TSR)$/.test(it));
        const max = def.maxLengthKey ? this.int(def.maxLengthKey) : 1;
        return ok && items.length > 0 && items.length <= max ? items.join(',') : undefined;
      }
      case 'string':
        return v;
    }
  }
}
