import type { BootStatus, ConnectorStatus } from '@ev/shared';
import { ConfigStore } from './configuration';
import { type Sample, supportedMeasurands, takeSample } from './measurands';
import {
  type BootReason,
  type DeviceRequest,
  type OcppProfile,
  type OutCall,
  type StopReason,
  type TxRef,
  type UpdateTrigger,
  getProfile,
} from './profiles';
import { OcppRpcClient, RpcError } from './rpc';
import { KNOWN_UNSUPPORTED_16, validate16 } from './schema16';
import { type ChargingProfile, type EffectiveLimit, type Limits, SmartChargingStore, type TxContext } from './smartCharging';
import type {
  ChargerType,
  EmulatorConfig,
  EmulatorSettings,
  EmulatorSnapshot,
  FrameEntry,
  LinkState,
  Physics,
  SentSample,
} from './types';

const MAX_FRAMES = 400;
const CONNECTOR_ID = 1;
const RECONNECT_MS = 5_000;
const NETWORK_LABEL = { stable: 'estable', slow: 'lenta (latencia 0,4–1,5 s)', unstable: 'inestable (cortes y WeakSignal)' } as const;
const REBOOT_MS = 2_000;
const KNOWN_COMPONENTS = new Set(['AuthCtrlr', 'AlignedDataCtrlr', 'SampledDataCtrlr', 'TxCtrlr', 'OCPPCommCtrlr']);

export const DEFAULT_CONFIG: EmulatorConfig = {
  chargePointId: 'EMU-001',
  protocol: 'ocpp1.6',
  baseUrl: '',
  chargerType: 'AC',
  vendor: 'EVPlatform',
  model: 'Emulador',
  serialNumber: 'EMU-SN-001',
  firmwareVersion: '0.1.0',
};

export const DEFAULT_SETTINGS: EmulatorSettings = {
  rejectRemote: false,
  fluctuations: true,
  randomEvents: false,
  network: 'stable',
};

/**
 * Protecciones del equipo. Tensión AC según EN 50160 (230 V ±10 %); con histéresis para no
 * oscilar en el límite. Temperatura: reduce potencia desde 60 °C y corta a 75 °C.
 */
const PROTECTION = {
  underV: 207,
  overV: 253,
  hysteresisV: 5,
  derateC: 60,
  tripC: 75,
  resumeC: 70,
} as const;

/** Normal(0,1) aproximada (Irwin–Hall). */
const gauss = () => Math.random() + Math.random() + Math.random() - 1.5;
const between = (a: number, b: number) => a + Math.random() * (b - a);

/** Valores físicos iniciales: AC monofásico 32 A / 240 V; DC 50 kW. */
const physicsFor = (type: ChargerType): Physics => ({
  energyWh: 0,
  offeredW: type === 'AC' ? 7_680 : 50_000,
  powerW: 0,
  voltageV: type === 'AC' ? 240 : 400,
  currentA: 0,
  socPercent: 20,
  temperatureC: 25,
  batteryWh: 60_000,
  measuredVoltageV: type === 'AC' ? 240 : 400,
  measuredTemperatureC: 25,
  derate: 1,
  availableW: type === 'AC' ? 7_680 : 50_000,
});

/** El vehículo reduce la potencia sobre 80 % de SoC (curva CC/CV simplificada). */
const taper = (soc: number) => (soc < 80 ? 1 : Math.max(0, (100 - soc) / 20));

interface Authorization {
  idTag: string;
  idTokenType: string;
  parentIdTag?: string;
  remote: boolean;
  remoteStartId?: number;
  until?: number;
  /** TxProfile recibido en RemoteStartTransaction (§5.11): se instala al iniciar la transacción. */
  chargingProfile?: ChargingProfile;
}

interface ActiveTx {
  ref: TxRef;
  parentIdTag?: string;
  startedAt: string;
  meterStartWh: number;
  remote: boolean;
  /** Muestras para transactionData de StopTransaction / meterValue del Ended. */
  stopSamples: Sample[];
  periodicRegister: number;
  lastStatus: ConnectorStatus;
  remoteProfile?: ChargingProfile;
}

interface TxItem {
  label: string;
  build(): OutCall;
  onResult?(res: unknown): void;
  attempts: number;
  settled: boolean;
  settle(): void;
}

/**
 * Cargador OCPP emulado (un conector). Modela lo físico (energía, cable, vehículo,
 * fallas) y se comporta según la especificación:
 *  - OCPP 1.6 ed. 2 §4 (mensajes del Charge Point), §5 (comandos del Central System),
 *    §3.7 (cola de mensajes de transacción), §3.16 + §9.1 (qué medidas se envían y cuándo).
 *  - En 2.0.1/2.1, las mismas reglas con las variables del Device Model.
 */
export class EmulatedCharger {
  private config: EmulatorConfig;
  private settings: EmulatorSettings;
  private profile: OcppProfile;
  private cfg: ConfigStore;

  private powered = false;
  private link: LinkState = 'offline';
  private negotiated?: string;
  private bootStatus?: BootStatus;
  private bootAcceptedThisPowerCycle = false;
  private nextBootAt?: number;
  private clockOffsetMs = 0;
  private lastHeartbeatAt?: string;
  private lastOutboundAt = 0;
  private closingByUser = false;

  private plugged = false;
  private operative = true;
  private stationOperative = true;
  private scheduledAvailability?: { connectorId: number; operative: boolean };
  private scheduledReset = false;
  private faulted = false;
  private errorCode = 'NoError';
  /** Falla detectada por las protecciones del propio equipo (tensión, temperatura). */
  private autoFault?: { code: string; faulted: boolean };
  private noise = { v: 0, p: 0, t: 0, rise: 0 };
  private readonly smart = new SmartChargingStore();
  private smartLimit: EffectiveLimit = {};
  /** Límite de Smart Charging por debajo del mínimo de IEC 61851 (6 A) → el EVSE no ofrece energía. */
  private smartBlocked = false;
  private evPauseUntil = 0;
  private evCommUntil = 0;
  private evSuspendedManual = false;
  private evseSuspended = false;
  private evSideDisconnected = false;
  private finishing = false;
  private transientInfo?: string;
  private authorized?: Authorization;
  private lastAuthorization?: { idTag: string; status: string };
  private tx?: ActiveTx;
  private seqNo = 0;
  private physics: Physics;
  private clockRegister = 0;
  private lastSample?: SentSample;

  private readonly sentStatus = new Map<number, string>();
  private txQueue: TxItem[] = [];
  private pumping = false;
  private frames: FrameEntry[] = [];
  private frameSeq = 0;
  private lastError?: string;

  private rpc?: OcppRpcClient;
  private actions: Promise<unknown> = Promise.resolve();
  private physicsTimer?: ReturnType<typeof setInterval>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private periodicTimer?: ReturnType<typeof setInterval>;
  private endSampleTimer?: ReturnType<typeof setInterval>;
  private clockTimer?: ReturnType<typeof setTimeout>;
  private bootTimer?: ReturnType<typeof setTimeout>;
  private authTimer?: ReturnType<typeof setTimeout>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  constructor(
    init: { config?: Partial<EmulatorConfig>; settings?: Partial<EmulatorSettings> },
    private readonly onChange: (snapshot: EmulatorSnapshot) => void,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...init.config };
    this.settings = { ...DEFAULT_SETTINGS, ...init.settings };
    this.profile = getProfile(this.config.protocol);
    this.cfg = new ConfigStore(this.config.chargerType);
    this.physics = physicsFor(this.config.chargerType);
  }

  // ═══════════════════════════ Estado derivado ═══════════════════════════

  private get is16() {
    return this.config.protocol === 'ocpp1.6';
  }

  private get evSuspended() {
    return this.evSuspendedManual || this.evSideDisconnected || this.physics.socPercent >= 100 || Date.now() < this.evPauseUntil;
  }

  private get isFaulted() {
    return this.faulted || Boolean(this.autoFault?.faulted);
  }

  /** §7.6: EVCommunicationError no es Faulted; el equipo pasa a SuspendedEVSE (warning). */
  private get evCommError() {
    return Boolean(this.tx) && Date.now() < this.evCommUntil;
  }

  /** Estado del conector según la tabla de transiciones de §4.9. */
  get status(): ConnectorStatus {
    if (this.isFaulted) return 'Faulted';
    if (this.tx) {
      // §4.9: si suspenden ambos, SuspendedEVSE tiene precedencia.
      if (this.evseSuspended || this.evCommError || this.smartBlocked) return 'SuspendedEVSE';
      if (this.evSuspended) return 'SuspendedEV';
      return 'Charging';
    }
    if (!this.operative || !this.stationOperative) return 'Unavailable';
    if (this.finishing) return 'Finishing';
    if (this.plugged || this.authorized) return 'Preparing';
    return 'Available';
  }

  /** connectorId 0: solo Available, Unavailable o Faulted (§4.9). */
  private get stationStatus(): ConnectorStatus {
    return this.stationOperative ? 'Available' : 'Unavailable';
  }

  private get info(): string | undefined {
    return this.transientInfo ?? (this.tx && this.evSideDisconnected ? 'EV side disconnected' : undefined);
  }

  private get reportedErrorCode() {
    if (this.errorCode !== 'NoError') return this.errorCode; // lo fijado a mano manda
    if (this.faulted) return 'OtherError';
    if (this.autoFault) return this.autoFault.code;
    if (this.evCommError) return 'EVCommunicationError';
    return 'NoError';
  }

  /** connectorId 0 (1.6): el módem informa señal débil cuando la red es inestable (§7.6 WeakSignal). */
  private get stationErrorCode() {
    return this.settings.network === 'unstable' ? 'WeakSignal' : 'NoError';
  }

  private get accepted() {
    return this.link === 'connected' && this.bootStatus === 'Accepted';
  }

  private now() {
    return new Date(Date.now() + this.clockOffsetMs).toISOString();
  }

  snapshot(): EmulatorSnapshot {
    return {
      config: { ...this.config },
      settings: { ...this.settings },
      powered: this.powered,
      link: this.link,
      negotiated: this.negotiated,
      bootStatus: this.bootStatus,
      nextBootAt: this.nextBootAt ? new Date(this.nextBootAt).toISOString() : undefined,
      lastHeartbeatAt: this.lastHeartbeatAt,
      clockOffsetMs: this.clockOffsetMs,
      connectorId: CONNECTOR_ID,
      status: this.status,
      stationStatus: this.stationStatus,
      errorCode: this.reportedErrorCode,
      info: this.info,
      faulted: this.faulted,
      manualErrorCode: this.errorCode,
      protection: this.autoFault ? { ...this.autoFault } : undefined,
      plugged: this.plugged,
      operative: this.operative,
      stationOperative: this.stationOperative,
      scheduledAvailability: this.scheduledAvailability?.operative,
      evSuspended: this.evSuspendedManual,
      evseSuspended: this.evseSuspended,
      authorizedIdTag: this.authorized?.idTag,
      authorizedUntil: this.authorized?.until ? new Date(this.authorized.until).toISOString() : undefined,
      lastAuthorization: this.lastAuthorization,
      transaction: this.tx
        ? {
            id: this.tx.ref.transactionId,
            idTag: this.tx.ref.idTag,
            parentIdTag: this.tx.parentIdTag,
            startedAt: this.tx.startedAt,
            meterStartWh: this.tx.meterStartWh,
            remote: this.tx.remote,
          }
        : undefined,
      physics: { ...this.physics },
      chargingProfiles: this.smart.list(),
      smartLimit: { ...this.smartLimit, blocked: this.smartBlocked },
      lastSample: this.lastSample,
      queueLength: this.txQueue.length,
      configuration: this.cfg.entries(this.config.protocol),
      supportedMeasurands: supportedMeasurands(this.config.chargerType),
      frames: this.frames,
      lastError: this.lastError,
    };
  }

  private emit() {
    this.onChange(this.snapshot());
  }

  // ═══════════════════════════ Configuración local ═══════════════════════════

  /** Identidad/tipo/versión: solo con el equipo apagado (como en un equipo real). */
  configure(patch: Partial<EmulatorConfig>) {
    if (this.powered) return;
    const typeChanged = patch.chargerType && patch.chargerType !== this.config.chargerType;
    this.config = { ...this.config, ...patch };
    this.profile = getProfile(this.config.protocol);
    if (typeChanged) {
      this.cfg.setChargerType(this.config.chargerType);
      this.physics = { ...physicsFor(this.config.chargerType), energyWh: this.physics.energyWh };
    }
    this.emit();
  }

  updateSettings(patch: Partial<EmulatorSettings>) {
    const before = this.settings.network;
    this.settings = { ...this.settings, ...patch };
    if (!this.settings.fluctuations) this.noise = { v: 0, p: 0, t: 0, rise: 0 };
    if (!this.settings.randomEvents) this.evPauseUntil = this.evCommUntil = 0;
    if (this.settings.network !== before) {
      this.log(`Red: ${NETWORK_LABEL[this.settings.network]}`);
      this.enqueue(() => this.syncStatus(false, [0]));
    }
    this.emit();
  }

  /** Cambio de configuración desde el panel local del equipo (no desde el CSMS). */
  setConfigLocal(name: string, value: string): string {
    const status = this.cfg.change(this.config.protocol, name, value, 'local');
    if (status === 'Accepted') this.applyConfigChange(name);
    this.emit();
    return status;
  }

  /** Parámetros físicos (lo que en la realidad decide el hardware o el vehículo). */
  setPhysics(patch: Partial<Pick<Physics, 'offeredW' | 'voltageV' | 'temperatureC' | 'socPercent' | 'batteryWh'>>) {
    const before = this.statusKey;
    this.physics = { ...this.physics, ...patch };
    this.recomputePower();
    this.protect();
    this.recomputePower();
    if (this.statusKey !== before) this.enqueue(() => this.afterChange());
    this.emit();
  }

  clearFrames() {
    this.frames = [];
    this.emit();
  }

  // ═══════════════════════════ Energía y comunicación ═══════════════════════════

  powerOn() {
    if (this.powered) return;
    this.powered = true;
    this.physicsTimer = setInterval(() => this.tick(), 1000);
    this.clockRegister = this.physics.energyWh;
    this.restartClockTimer();
    this.log('Equipo encendido');
    this.connect('PowerUp');
  }

  /** Corte de energía: la transacción se interrumpe y se informa al volver (Reason PowerLoss). */
  powerOff() {
    if (!this.powered) return;
    if (this.tx) this.queueStop('PowerLoss', undefined);
    this.powered = false;
    this.clearAuthorization();
    this.evseSuspended = false;
    this.bootAcceptedThisPowerCycle = false;
    this.stopAllTimers();
    this.closingByUser = true;
    this.closeLink();
    this.bootStatus = undefined;
    this.nextBootAt = undefined;
    this.physics.powerW = 0;
    this.physics.currentA = 0;
    this.log('Equipo apagado');
    this.emit();
  }

  /** Restablecer la comunicación (sin reiniciar el equipo). */
  connect(reason: BootReason = 'PowerUp') {
    if (!this.powered || this.link !== 'offline') return;
    clearTimeout(this.reconnectTimer);
    this.closingByUser = false;
    this.link = 'connecting';
    this.lastError = undefined;
    this.emit();

    const rpc = new OcppRpcClient(
      {
        onFrame: (f) => this.pushFrame(f),
        onCall: (action, payload) => this.onCsmsCall(action, payload),
        onClose: (code, why) => this.onSocketClosed(code, why),
      },
      30_000,
    );
    rpc.latency = () => (this.settings.network === 'stable' ? 0 : Math.round(between(400, 1500)));
    this.rpc = rpc;
    const base = (this.config.baseUrl || defaultBaseUrl()).replace(/\/+$/, '');
    const url = `${base}/${encodeURIComponent(this.config.chargePointId)}`;
    this.log(`Conectando a ${url} · Sec-WebSocket-Protocol: ${this.config.protocol}`);

    rpc
      .connect(url, this.config.protocol)
      .then((negotiated) => {
        this.link = 'connected';
        this.negotiated = negotiated || '(ninguno)';
        this.log(`WebSocket abierto · subprotocolo ${this.negotiated}`);
        this.emit();
        // §4.2: el BootNotification se envía al arrancar; una reconexión sin reinicio no lo repite.
        if (this.bootAcceptedThisPowerCycle) {
          this.bootStatus = 'Accepted';
          this.enqueue(() => this.onAccepted(false));
        } else {
          this.enqueue(() => this.boot(reason));
        }
      })
      .catch((e: Error) => {
        this.link = 'offline';
        this.rpc = undefined;
        this.fail(e.message);
        this.scheduleReconnect();
      });
  }

  /** Cortar la comunicación: el equipo sigue funcionando y encola los mensajes de transacción. */
  disconnect() {
    this.closingByUser = true;
    clearTimeout(this.reconnectTimer);
    this.closeLink();
  }

  private closeLink() {
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.bootTimer);
    this.rpc?.close(1000, this.powered ? 'Comunicación cortada' : 'Apagado');
  }

  private onSocketClosed(code: number, why: string) {
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.bootTimer);
    this.rpc = undefined;
    this.link = 'offline';
    this.negotiated = undefined;
    if (!this.bootAcceptedThisPowerCycle) this.bootStatus = undefined;
    this.pushFrame({
      at: this.now(),
      dir: 'sys',
      kind: 'INFO',
      text: `WebSocket cerrado (${code}${why ? ` · ${why}` : ''})`,
      error: !this.closingByUser && this.powered,
    });
    this.emit();
    if (!this.closingByUser) this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (!this.powered || this.closingByUser) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect('PowerUp'), RECONNECT_MS);
  }

  private reboot(reason: BootReason) {
    this.log('Reiniciando…');
    this.closingByUser = true;
    this.bootAcceptedThisPowerCycle = false;
    this.bootStatus = undefined;
    this.clearAuthorization();
    this.closeLink();
    setTimeout(() => {
      if (!this.powered) return;
      this.closingByUser = false;
      this.connect(reason);
    }, REBOOT_MS);
  }

  // ═══════════════════════════ Boot y Heartbeat (§4.2, §4.6) ═══════════════════════════

  private async boot(reason: BootReason, triggered = false) {
    clearTimeout(this.bootTimer);
    this.nextBootAt = undefined;
    const res = await this.callDirect<{ status?: BootStatus; interval?: number; currentTime?: string }>(
      this.profile.boot(this.config, reason),
      { triggered },
    );
    if (!res) return;
    this.syncClock(res.currentTime);
    this.bootStatus = res.status;
    const interval = Math.max(0, res.interval ?? 0);

    if (res.status === 'Accepted') {
      this.bootAcceptedThisPowerCycle = true;
      this.cfg.setInternal('HeartbeatInterval', String(interval));
      await this.onAccepted(true);
      return;
    }
    // Pending/Rejected: interval = espera mínima antes del siguiente Boot (0 → la elige el cargador).
    const waitSec = interval > 0 ? interval : 30;
    this.nextBootAt = Date.now() + waitSec * 1000;
    this.bootTimer = setTimeout(() => this.enqueue(() => this.boot(reason)), waitSec * 1000);
    this.emit();
  }

  private async onAccepted(afterBoot: boolean) {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => this.heartbeatCheck(), 1000);
    // §4.9: tras el boot se informa el estado actual; tras una reconexión, solo lo que cambió.
    if (afterBoot) this.sentStatus.clear();
    await this.syncStatus();
    void this.pump();
    this.emit();
  }

  /** HeartbeatInterval = intervalo de INACTIVIDAD: cualquier otro PDU lo reinicia (§4.6, §9.1.10). */
  private heartbeatCheck() {
    const interval = this.cfg.int('HeartbeatInterval');
    if (!this.accepted || interval <= 0) return;
    if (Date.now() - this.lastOutboundAt >= interval * 1000) {
      this.lastOutboundAt = Date.now(); // evita encolar varios mientras sale
      this.enqueue(() => this.heartbeat());
    }
  }

  private async heartbeat(triggered = false) {
    const res = await this.callDirect<{ currentTime?: string }>(this.profile.heartbeat(), { triggered });
    if (!res) return;
    this.syncClock(res.currentTime);
    this.lastHeartbeatAt = this.now();
    this.emit();
  }

  /** Se RECOMIENDA sincronizar el reloj con currentTime (§4.2, §4.6). */
  private syncClock(currentTime?: string) {
    const t = currentTime ? Date.parse(currentTime) : Number.NaN;
    if (Number.isFinite(t)) this.clockOffsetMs = t - Date.now();
  }

  // ═══════════════════════════ Acciones físicas ═══════════════════════════

  plugIn() {
    this.enqueue(async () => {
      if (this.plugged) return;
      this.plugged = true;
      if (this.tx && this.evSideDisconnected) {
        // StopTransactionOnEVSideDisconnect=false: al reconectar se permite energía de nuevo.
        this.evSideDisconnected = false;
        return this.afterChange();
      }
      this.finishing = false;
      if (this.authorized) return this.startTransaction('CablePluggedIn');
      await this.afterChange(); // A2: Preparing
    });
  }

  unplug() {
    this.enqueue(async () => {
      if (!this.plugged) return;
      if (this.tx && this.cfg.bool('StopTransactionOnEVSideDisconnect')) {
        // §4.9: StopTransaction (EVDisconnected) y Finishing con info "EV side disconnected";
        // luego, sin cable, el conector queda Available (F1).
        this.transientInfo = 'EV side disconnected';
        await this.stopTransaction('EVDisconnected');
        this.transientInfo = undefined;
      } else if (this.tx) {
        // §4.9: SuspendedEV, errorCode NoError, info "EV side disconnected"; la transacción sigue.
        this.plugged = false;
        this.evSideDisconnected = true;
        return this.afterChange();
      }
      this.plugged = false;
      this.finishing = false;
      await this.afterChange();
    });
  }

  /** Presentar una tarjeta RFID. */
  presentCard(idTag: string) {
    this.enqueue(async () => {
      const tag = idTag.trim();
      if (!tag || !this.powered) return;
      if (this.isFaulted || this.status === 'Unavailable') return this.fail(`Conector ${this.status}: no admite uso`);

      if (this.tx) {
        // §4.1: no se envía Authorize si es el mismo identificador que inició la transacción.
        if (tag === this.tx.ref.idTag) return this.stopTransaction('Local', tag);
        const auth = await this.authorizeOnline(tag, 'ISO14443');
        if (!auth) return;
        if (auth.status === 'Accepted' && auth.parentIdTag && auth.parentIdTag === this.tx.parentIdTag) {
          return this.stopTransaction('Local', tag);
        }
        return this.fail(`${tag} no puede detener la transacción de ${this.tx.ref.idTag} (parentIdTag distinto)`);
      }

      if (this.authorized) {
        // B1: una segunda presentación del mismo idTag termina el uso.
        if (this.authorized.idTag === tag) {
          this.clearAuthorization();
          return this.afterChange();
        }
        return this.fail(`Ya hay un idTag autorizado esperando el cable (${this.authorized.idTag})`);
      }

      const auth = await this.authorizeOnline(tag, 'ISO14443');
      if (!auth || auth.status !== 'Accepted') return;
      this.setAuthorization({ idTag: tag, idTokenType: 'ISO14443', parentIdTag: auth.parentIdTag, remote: false });
      if (this.plugged) return this.startTransaction('Authorized');
      await this.afterChange(); // A2: Preparing, corre ConnectionTimeOut
    });
  }

  /** Botón de parada del equipo (sin identificador). */
  stopLocal() {
    this.enqueue(() => this.stopTransaction('Local'));
  }

  setEvSuspended(value: boolean) {
    this.enqueue(async () => {
      this.evSuspendedManual = value;
      await this.afterChange();
    });
  }

  setEvseSuspended(value: boolean) {
    this.enqueue(async () => {
      this.evseSuspended = value;
      await this.afterChange();
    });
  }

  /** errorCode sin falla = advertencia (el estado no cambia); con falla → Faulted (§4.9). */
  setFault(faulted: boolean, errorCode: string) {
    this.enqueue(async () => {
      this.faulted = faulted;
      this.errorCode = errorCode;
      await this.afterChange();
    });
  }

  // ═══════════════════════════ Mensajes manuales (pruebas) ═══════════════════════════

  sendBoot() {
    this.enqueue(() => this.boot('Triggered', true));
  }
  sendHeartbeat() {
    this.enqueue(() => this.heartbeat(true));
  }
  sendStatus() {
    this.enqueue(() => this.syncStatus(true));
  }
  sendCustom(action: string, payload: Record<string, unknown>) {
    this.enqueue(() => this.callDirect({ action, payload }, { manual: true }));
  }
  sendRawText(text: string) {
    try {
      if (!this.rpc) throw new Error('Sin conexión con el CSMS');
      this.rpc.sendRaw(text);
    } catch (e) {
      this.fail((e as Error).message);
    }
  }

  // ═══════════════════════════ Autorización ═══════════════════════════

  /** Sin lista local ni caché (LocalAuthorizeOffline = false): solo se autoriza online. */
  private async authorizeOnline(idTag: string, idTokenType: string) {
    if (!this.accepted) {
      this.fail('Sin conexión aceptada con el CSMS: no hay lista local para autorizar offline');
      return undefined;
    }
    const res = await this.callDirect(this.profile.authorize(idTag, idTokenType));
    if (!res) return undefined;
    const r = this.profile.authResult(res);
    this.lastAuthorization = { idTag, status: r.status };
    this.emit();
    return r;
  }

  private setAuthorization(a: Authorization) {
    clearTimeout(this.authTimer);
    const timeout = this.cfg.int('ConnectionTimeOut');
    this.authorized = { ...a, until: !this.plugged && timeout > 0 ? Date.now() + timeout * 1000 : undefined };
    if (this.authorized.until) {
      this.authTimer = setTimeout(
        () =>
          this.enqueue(async () => {
            if (!this.authorized || this.tx) return;
            this.log(`ConnectionTimeOut (${timeout} s): no se conectó el cable, se cancela la autorización`);
            this.clearAuthorization();
            await this.afterChange(); // B1 → Available
          }),
        timeout * 1000,
      );
    }
  }

  private clearAuthorization() {
    clearTimeout(this.authTimer);
    this.authorized = undefined;
  }

  // ═══════════════════════════ Transacción ═══════════════════════════

  private async startTransaction(trigger: 'Authorized' | 'CablePluggedIn' | 'RemoteStart') {
    const a = this.authorized;
    if (!a || this.tx || !this.plugged) return;
    this.clearAuthorization();
    this.finishing = false;
    this.seqNo = 0;

    const at = this.now();
    const ref: TxRef = {
      connectorId: CONNECTOR_ID,
      transactionId: this.is16 ? '' : crypto.randomUUID(),
      idTag: a.idTag,
      idTokenType: a.idTokenType,
      remoteStartId: a.remoteStartId,
      seqNo: 0,
      offline: !this.accepted,
      status: 'Charging',
      startTrigger: a.remote ? 'RemoteStart' : trigger,
    };
    const tx: ActiveTx = {
      ref,
      parentIdTag: a.parentIdTag,
      startedAt: at,
      meterStartWh: Math.round(this.physics.energyWh),
      remote: a.remote,
      stopSamples: [],
      periodicRegister: this.physics.energyWh,
      lastStatus: 'Charging',
      remoteProfile: a.chargingProfile,
    };
    this.tx = tx;
    this.installRemoteProfile(tx); // 2.x: el id ya existe
    tx.lastStatus = ref.status = this.status;
    this.recomputePower();

    const begin = this.sample(this.stopMeasurands(), 'Transaction.Begin', at);
    if (begin) tx.stopSamples.push(begin);
    const started = this.is16 ? undefined : this.sample(this.cfg.list('TxStartedMeasurands'), 'Transaction.Begin', at);
    const startRef: TxRef = { ...ref, seqNo: this.seqNo++ };

    await this.sendTx('Start', () => this.profile.startTransaction(startRef, tx.meterStartWh, at, started), (res) => {
      const r = this.profile.startResult(res, ref);
      ref.transactionId = r.transactionId;
      this.installRemoteProfile(tx); // 1.6: el id lo asigna el Central System
      tx.parentIdTag = r.parentIdTag ?? tx.parentIdTag;
      this.lastAuthorization = { idTag: ref.idTag, status: r.status };
      if (r.status !== 'Accepted' && this.tx === tx) {
        // §4.8 / §9.1.24: el CSMS invalidó el idTag.
        if (this.cfg.bool('StopTransactionOnInvalidId')) this.enqueue(() => this.stopTransaction('DeAuthorized'));
        else {
          this.evseSuspended = true; // C5
          this.enqueue(() => this.afterChange());
        }
      }
      this.emit();
    });
    this.restartTxTimers();
    await this.afterChange();
  }

  /** Detiene la transacción enviando StopTransaction / TransactionEvent Ended. */
  private async stopTransaction(reason: StopReason, idTag?: string) {
    if (!this.tx) return;
    this.queueStop(reason, idTag);
    this.finishing = this.plugged;
    this.applyScheduled();
    await this.afterChange();
    if (this.scheduledReset) {
      this.scheduledReset = false;
      this.reboot('RemoteReset');
    }
  }

  /** Arma el mensaje de fin de transacción y lo pone en la cola de transacciones. */
  private queueStop(reason: StopReason, idTag: string | undefined) {
    const tx = this.tx;
    if (!tx) return;
    clearInterval(this.periodicTimer);
    clearInterval(this.endSampleTimer);
    const at = this.now();
    const meterStop = this.physics.energyWh;
    const end = this.sample(this.stopMeasurands(), 'Transaction.End', at);
    const data = [...tx.stopSamples, ...(end ? [end] : [])];

    this.tx = undefined;
    if (tx.ref.transactionId) this.smart.endTransaction(tx.ref.transactionId);
    this.evseSuspended = false;
    this.evSuspendedManual = false;
    this.evSideDisconnected = false;
    this.recomputePower();

    const ref: TxRef = {
      ...tx.ref,
      seqNo: this.seqNo++,
      offline: !this.accepted,
      status: this.plugged ? 'Finishing' : 'Available',
    };
    void this.sendTx('Stop', () =>
      this.profile.stopTransaction({ ...ref, transactionId: tx.ref.transactionId }, reason, meterStop, at, data, idTag),
    );
  }

  /** §5.2: un cambio de disponibilidad programado se aplica al terminar la transacción. */
  private applyScheduled() {
    const s = this.scheduledAvailability;
    if (!s) return;
    this.scheduledAvailability = undefined;
    if (s.connectorId === 0) this.stationOperative = s.operative;
    this.operative = s.operative;
  }

  /** Lo que cambió desde el último aviso: StatusNotification y, en 2.x, chargingState. */
  private async afterChange() {
    this.recomputePower();
    this.emit();
    const tx = this.tx;
    if (tx && this.status !== tx.lastStatus) {
      tx.lastStatus = tx.ref.status = this.status;
      const at = this.now();
      // 1.6 no tiene mensaje para esto (devuelve undefined): el cambio va solo por StatusNotification.
      if (this.profile.txUpdate(tx.ref, 'ChargingStateChanged', at)) {
        const ref: TxRef = { ...tx.ref, seqNo: this.seqNo++, offline: !this.accepted };
        void this.sendTx('ChargingStateChanged', () =>
          this.profile.txUpdate({ ...ref, transactionId: tx.ref.transactionId }, 'ChargingStateChanged', at)!,
        );
      }
    }
    await this.syncStatus();
  }

  private async syncStatus(force = false, only?: number[]) {
    if (!this.accepted && !(force && this.bootStatus === 'Pending')) return;
    const targets = (this.is16 ? [0, CONNECTOR_ID] : [CONNECTOR_ID]).filter((c) => !only || only.includes(c));
    for (const c of targets) {
      const status = c === 0 ? this.stationStatus : this.status;
      const errorCode = c === 0 ? this.stationErrorCode : this.reportedErrorCode;
      const info = c === 0 ? undefined : this.info;
      const key = this.profile.statusKey(status, errorCode, info);
      if (!force && this.sentStatus.get(c) === key) continue;
      const res = await this.callDirect(this.profile.statusNotification(c, status, errorCode, info, this.now()), {
        triggered: force,
      });
      if (res) this.sentStatus.set(c, key);
    }
  }

  // ═══════════════════════════ Medidor (§3.16) ═══════════════════════════

  private stopMeasurands() {
    return this.cfg.list('StopTxnSampledData');
  }

  private sample(measurands: string[], context: Parameters<typeof takeSample>[2], at: string, intervalWh?: number) {
    return takeSample(measurands, this.physics, context, this.config.chargerType, { timestamp: at, intervalWh });
  }

  private recomputePower() {
    const p = this.physics;
    const n = this.noise;
    p.measuredVoltageV = p.voltageV * (1 + n.v);
    p.measuredTemperatureC = p.temperatureC + n.rise + n.t;
    p.derate = p.measuredTemperatureC >= PROTECTION.derateC ? 0.5 : 1;
    this.updateSmartLimit();
    p.availableW = this.smartBlocked ? 0 : Math.min(p.offeredW * p.derate, this.smartLimit.watts ?? Number.POSITIVE_INFINITY);
    const charging = this.powered && this.status === 'Charging';
    p.powerW = charging ? Math.max(0, p.availableW * taper(p.socPercent) * (1 + n.p)) : 0;
    p.currentA = p.measuredVoltageV > 0 ? p.powerW / p.measuredVoltageV : 0;
  }

  // ═══════════════════════════ Smart Charging (§3.13) ═══════════════════════════

  private txContext(): TxContext | undefined {
    const tx = this.tx;
    return tx && tx.ref.transactionId
      ? { connectorId: tx.ref.connectorId, transactionId: tx.ref.transactionId, startedAt: Date.parse(tx.startedAt) }
      : undefined;
  }

  private smartLimits(): Limits {
    const units = this.cfg.list('ChargingScheduleAllowedChargingRateUnit');
    return {
      maxStackLevel: this.cfg.int('ChargeProfileMaxStackLevel') || 5,
      maxPeriods: this.cfg.int('ChargingScheduleMaxPeriods') || 24,
      maxInstalled: this.cfg.int('MaxChargingProfilesInstalled') || 10,
      allowedUnits: units.length ? units.map((u) => (u === 'Power' ? 'W' : 'A')) : ['A', 'W'],
      connectors: 1,
    };
  }

  private electrical() {
    return { voltageV: this.physics.measuredVoltageV || this.physics.voltageV, phases: 1 };
  }

  private updateSmartLimit() {
    this.smartLimit = this.smart.effective(CONNECTOR_ID, Date.now(), this.electrical(), this.txContext());
    const w = this.smartLimit.watts;
    // IEC 61851-1: por debajo de 6 A el piloto no puede ofrecer carga en AC.
    const minW = this.config.chargerType === 'AC' ? 6 * this.electrical().voltageV : 0;
    this.smartBlocked = w !== undefined && (w <= 0 || w < minW);
  }

  /** TxProfile de RemoteStart: se instala cuando la transacción ya tiene id. */
  private installRemoteProfile(tx: ActiveTx) {
    if (!tx.remoteProfile || !tx.ref.transactionId) return;
    const r = this.smart.set({ ...tx.remoteProfile, transactionId: undefined, connectorId: tx.ref.connectorId }, this.smartLimits(), this.txContext());
    this.log(r.status === 'Accepted' ? `TxProfile #${tx.remoteProfile.id} del RemoteStart instalado` : `TxProfile del RemoteStart descartado: ${r.reason}`);
    tx.remoteProfile = undefined;
  }

  /** Ruido de red eléctrica y calentamiento (constante térmica ~2 min). */
  private fluctuate() {
    const n = this.noise;
    if (!this.settings.fluctuations) return;
    n.v = Math.max(-0.025, Math.min(0.025, n.v * 0.9 + gauss() * 0.004)); // ±2,5 % máx.
    n.p = Math.max(-0.015, Math.min(0.015, gauss() * 0.006));
    n.t = gauss() * 0.15;
    const target = this.physics.powerW > 0 ? 12 * Math.sqrt(this.physics.powerW / 22_000) : 0;
    n.rise += (target - n.rise) / 120;
  }

  /** Protecciones del hardware: deciden un errorCode §7.6 sin intervención del usuario. */
  private protect() {
    const p = this.physics;
    const prev = this.autoFault;
    let next: typeof prev;
    if (this.config.chargerType === 'AC') {
      const v = p.measuredVoltageV;
      const h = prev?.code === 'UnderVoltage' || prev?.code === 'OverVoltage' ? PROTECTION.hysteresisV : 0;
      if (v < PROTECTION.underV + h) next = { code: 'UnderVoltage', faulted: true };
      else if (v > PROTECTION.overV - h) next = { code: 'OverVoltage', faulted: true };
    }
    if (!next) {
      const t = p.measuredTemperatureC;
      const tripped = prev?.code === 'HighTemperature' && prev.faulted;
      if (t >= PROTECTION.tripC || (tripped && t > PROTECTION.resumeC)) next = { code: 'HighTemperature', faulted: true };
      else if (t >= PROTECTION.derateC) next = { code: 'HighTemperature', faulted: false }; // aviso + reducción
    }
    if (next?.code !== prev?.code || next?.faulted !== prev?.faulted) {
      this.autoFault = next;
      this.log(
        next
          ? `Protección: ${next.code}${next.faulted ? ' → Faulted' : ' (aviso, potencia reducida al 50 %)'}`
          : `Protección restablecida (${prev?.code})`,
      );
    }
  }

  /** Pausas del EV (gestión térmica de batería) y cortes del piloto de control. */
  private randomEvent() {
    if (!this.settings.randomEvents || !this.tx || this.status !== 'Charging') return;
    const now = Date.now();
    if (Math.random() < 1 / 240) {
      this.evPauseUntil = now + between(15_000, 40_000);
      this.log('Evento: el vehículo pausa la carga (SuspendedEV)');
    } else if (Math.random() < 1 / 300) {
      this.evCommUntil = now + between(5_000, 12_000);
      this.log('Evento: falla de comunicación con el vehículo (EVCommunicationError → SuspendedEVSE)');
    }
  }

  /** Red inestable: cortes de 5–20 s cada pocos minutos (el equipo sigue cargando y encola, §3.7). */
  private networkTick() {
    if (this.settings.network !== 'unstable' || this.link !== 'connected') return;
    if (Math.random() < 1 / 120) {
      this.log('Red: pérdida de señal');
      this.rpc?.close(4001, 'Pérdida de señal');
    }
  }

  private get statusKey() {
    return `${this.status}|${this.reportedErrorCode}`;
  }

  /** Integración física cada segundo (tiempo real: la energía es potencia × tiempo). */
  private tick() {
    const before = this.statusKey;
    this.fluctuate();
    this.recomputePower();
    this.protect();
    this.randomEvent();
    this.networkTick();
    this.recomputePower();
    const deltaWh = this.physics.powerW / 3600;
    this.physics.energyWh += deltaWh;
    if (this.plugged) {
      this.physics.socPercent = Math.min(100, this.physics.socPercent + (deltaWh / this.physics.batteryWh) * 100);
    }
    // Batería llena, protección o evento → StatusNotification (C4, C5, C→F, F→C…).
    if (this.statusKey !== before) this.enqueue(() => this.afterChange());
    this.emit();
  }

  /** MeterValueSampleInterval: desde el INICIO de la transacción (§9.1.19). 0 = no enviar. */
  private restartTxTimers() {
    clearInterval(this.periodicTimer);
    clearInterval(this.endSampleTimer);
    if (!this.tx) return;
    const interval = this.cfg.int('MeterValueSampleInterval');
    if (interval > 0) this.periodicTimer = setInterval(() => this.enqueue(() => this.periodicSample()), interval * 1000);
    // 2.x: TxEndedInterval es independiente; en 1.6 StopTxnSampledData usa MeterValueSampleInterval.
    const endInterval = this.is16 ? 0 : this.cfg.int('TxEndedInterval');
    if (endInterval > 0) {
      this.endSampleTimer = setInterval(() => {
        const s = this.tx && this.sample(this.stopMeasurands(), 'Sample.Periodic', this.now());
        if (s) this.tx!.stopSamples.push(s);
      }, endInterval * 1000);
    }
  }

  private async periodicSample() {
    const tx = this.tx;
    if (!tx) return;
    const at = this.now();
    const intervalWh = this.physics.energyWh - tx.periodicRegister;
    tx.periodicRegister = this.physics.energyWh;
    if (this.is16) {
      const s = this.sample(this.stopMeasurands(), 'Sample.Periodic', at);
      if (s) tx.stopSamples.push(s);
    }
    const sample = this.sample(this.cfg.list('MeterValuesSampledData'), 'Sample.Periodic', at, intervalWh);
    if (sample) await this.sendTxUpdate(tx, 'MeterValuePeriodic', at, sample);
  }

  /** ClockAlignedDataInterval: intervalos parejos desde las 00:00:00 (§3.16.2). */
  private restartClockTimer() {
    clearTimeout(this.clockTimer);
    const interval = this.cfg.int('ClockAlignedDataInterval');
    if (!this.powered || interval <= 0) return;
    const ms = interval * 1000;
    const d = new Date();
    const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const next = midnight + Math.floor((Date.now() - midnight) / ms + 1) * ms;
    this.clockTimer = setTimeout(() => {
      this.enqueue(() => this.clockSample(next, ms));
      this.restartClockTimer();
    }, next - Date.now());
  }

  /** Se transmite al final de cada intervalo con el timestamp de INICIO del intervalo. */
  private async clockSample(boundary: number, ms: number) {
    const at = new Date(boundary - ms + this.clockOffsetMs).toISOString();
    const intervalWh = this.physics.energyWh - this.clockRegister;
    this.clockRegister = this.physics.energyWh;
    const tx = this.tx;
    if (tx) {
      const s = this.sample(this.cfg.list('StopTxnAlignedData'), 'Sample.Clock', at, intervalWh);
      if (s) tx.stopSamples.push(s);
    }
    const sample = this.sample(this.cfg.list('MeterValuesAlignedData'), 'Sample.Clock', at, intervalWh);
    if (!sample) return;
    if (tx) await this.sendTxUpdate(tx, 'MeterValueClock', at, sample);
    else await this.sendTx('MeterValues', () => this.profile.meterValues(CONNECTOR_ID, sample));
  }

  private async sendTxUpdate(tx: ActiveTx, trigger: UpdateTrigger, at: string, sample: Sample) {
    const ref: TxRef = { ...tx.ref, seqNo: this.seqNo++, offline: !this.accepted };
    await this.sendTx(trigger, () => this.profile.txUpdate({ ...ref, transactionId: tx.ref.transactionId }, trigger, at, sample)!);
  }

  // ═══════════════════════════ Envío de mensajes ═══════════════════════════

  /**
   * Mensajes NO de transacción. §4.2: antes del Boot Accepted solo se permite el propio
   * BootNotification; con Pending, solo lo que pida un TriggerMessage.
   */
  private async callDirect<T = Record<string, unknown>>(
    out: OutCall,
    opts: { triggered?: boolean; manual?: boolean } = {},
  ): Promise<T | undefined> {
    const allowed =
      out.action === 'BootNotification' || this.accepted || (this.bootStatus === 'Pending' && Boolean(opts.triggered));
    if (!this.rpc || this.link !== 'connected') {
      this.fail(`${out.action} no enviado: sin conexión`);
      return undefined;
    }
    if (!allowed && !opts.manual) {
      this.fail(`${out.action} no enviado: el BootNotification no fue aceptado (§4.2)`);
      return undefined;
    }
    if (!allowed) this.log(`Aviso: ${out.action} enviado fuera de la secuencia permitida (§4.2), como prueba`);
    try {
      return await this.rawCall<T>(out);
    } catch (e) {
      this.fail(`${out.action}: ${(e as Error).message}`);
      return undefined;
    }
  }

  /**
   * Mensajes de transacción (§3.7): Start/Stop/MeterValues. Se encolan en orden, se
   * guardan sin conexión y se reintentan según TransactionMessageAttempts/RetryInterval.
   * La promesa se resuelve tras el primer intento (o al encolar si no hay conexión).
   */
  private sendTx(label: string, build: () => OutCall, onResult?: (res: unknown) => void): Promise<void> {
    return new Promise((resolve) => {
      const item: TxItem = {
        label,
        build,
        onResult,
        attempts: 0,
        settled: false,
        settle: () => {
          if (!item.settled) {
            item.settled = true;
            resolve();
          }
        },
      };
      this.txQueue.push(item);
      if (!this.accepted) {
        this.log(`${label} en cola: sin conexión aceptada (§3.7)`);
        item.settle();
      }
      this.emit();
      void this.pump();
    });
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.txQueue.length && this.accepted) {
        const item = this.txQueue[0]!;
        try {
          const res = await this.rawCall(item.build());
          this.txQueue.shift();
          item.onResult?.(res);
          item.settle();
        } catch (e) {
          if (!this.accepted) break; // se perdió la conexión: queda en cola
          item.attempts++;
          const max = Math.max(1, this.cfg.int('TransactionMessageAttempts'));
          if (item.attempts >= max) {
            this.txQueue.shift();
            this.fail(`${item.label} descartado tras ${item.attempts} intento(s): ${(e as Error).message} (§3.7.1)`);
            item.settle();
            continue;
          }
          const waitSec = this.cfg.int('TransactionMessageRetryInterval') * item.attempts;
          this.fail(`${item.label} falló (${(e as Error).message}); reintento ${item.attempts + 1}/${max} en ${waitSec} s`);
          item.settle();
          this.emit();
          await new Promise((r) => setTimeout(r, waitSec * 1000));
        }
      }
    } finally {
      this.pumping = false;
      this.emit();
    }
  }

  /** Espera a que la cola de transacción se vacíe (antes de un reinicio ordenado). */
  private async drainQueue(timeoutMs = 10_000) {
    const t0 = Date.now();
    while (this.txQueue.length && this.accepted && Date.now() - t0 < timeoutMs) {
      void this.pump();
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  private async rawCall<T = Record<string, unknown>>(out: OutCall): Promise<T> {
    if (!this.rpc) throw new Error('Sin conexión con el CSMS');
    const res = await this.rpc.call<T>(out.action, out.payload);
    this.lastOutboundAt = Date.now();
    this.recordSample(out);
    return res;
  }

  private recordSample(out: OutCall) {
    const mv = out.payload.meterValue ?? out.payload.transactionData;
    if (!Array.isArray(mv) || !mv.length) return;
    const last = mv[mv.length - 1] as {
      timestamp: string;
      sampledValue: { measurand?: string; value: unknown; context?: string }[];
    };
    const values: Record<string, number> = {};
    for (const sv of last.sampledValue) values[sv.measurand ?? 'Energy.Active.Import.Register'] = Number(sv.value);
    this.lastSample = { timestamp: last.timestamp, context: last.sampledValue[0]?.context ?? 'Sample.Periodic', values };
  }

  // ═══════════════════════════ Comandos del CSMS (§5) ═══════════════════════════

  private async onCsmsCall(action: string, payload: unknown) {
    // §4.2: con Rejected el cargador no responde a nada.
    if (this.bootStatus === 'Rejected') return null;
    if (this.config.protocol === 'ocpp1.6') {
      validate16(action, payload); // §6 tamaños/cardinalidad/enums → CALLERROR específico
      if (action === 'DataTransfer') return { response: { status: 'UnknownVendorId' } }; // §5.6: ningún vendorId conocido
      if (action === 'GetConfiguration') {
        const keys = (payload as { key?: unknown[] }).key;
        if (keys && keys.length > this.cfg.int('GetConfigurationMaxKeys')) {
          throw new RpcError('OccurenceConstraintViolation', `GetConfiguration.key: máximo ${this.cfg.int('GetConfigurationMaxKeys')} claves (GetConfigurationMaxKeys)`);
        }
      }
    }
    const req = this.profile.parseIncoming(action, payload);
    if (req.kind === 'Unsupported') {
      // NotSupported = acción conocida pero no soportada; NotImplemented = acción desconocida (OCPP-J §4.2.3).
      if (this.config.protocol === 'ocpp1.6' && KNOWN_UNSUPPORTED_16.has(action)) {
        throw new RpcError('NotSupported', `${action} pertenece a un perfil que este equipo no declara en SupportedFeatureProfiles`);
      }
      throw new RpcError('NotImplemented', `${action} no está implementado en el emulador`);
    }
    const { response, after } = this.handle(req);
    return { response, after: after ? () => this.enqueue(after) : undefined };
  }

  private handle(req: Exclude<DeviceRequest, { kind: 'Unsupported' }>): {
    response: Record<string, unknown>;
    after?: () => Promise<void>;
  } {
    const test = this.settings.rejectRemote;
    const pending = this.bootStatus === 'Pending';
    const status = (s: string) => ({ status: s });

    switch (req.kind) {
      case 'RemoteStart': {
        const busy = Boolean(this.tx) || Boolean(this.authorized) || this.isFaulted || this.status === 'Unavailable';
        const badConnector = req.connectorId !== undefined && req.connectorId !== CONNECTOR_ID;
        // §4.2: en Pending no se admite RemoteStartTransaction.
        // §5.11: el chargingProfile de RemoteStart debe ser TxProfile y sin transactionId.
        const badProfile = req.chargingProfile && (req.chargingProfile.purpose !== 'TxProfile' || req.chargingProfile.transactionId);
        if (test || pending || busy || badConnector || !req.idTag || badProfile) return { response: status('Rejected') };
        return {
          response: status('Accepted'),
          after: async () => {
            let parentIdTag: string | undefined;
            // §5.11: con AuthorizeRemoteTxRequests=true se autoriza como un inicio local.
            if (this.cfg.bool('AuthorizeRemoteTxRequests')) {
              const auth = await this.authorizeOnline(req.idTag, req.idTokenType);
              if (!auth || auth.status !== 'Accepted') return this.afterChange();
              parentIdTag = auth.parentIdTag;
            }
            this.setAuthorization({
              idTag: req.idTag,
              idTokenType: req.idTokenType,
              parentIdTag,
              remote: true,
              remoteStartId: req.remoteStartId,
              chargingProfile: req.chargingProfile,
            });
            if (this.plugged) return this.startTransaction('RemoteStart');
            await this.afterChange(); // A2: Preparing, espera el cable (ConnectionTimeOut)
          },
        };
      }

      case 'RemoteStop':
        if (test || pending || !this.tx || this.tx.ref.transactionId !== req.transactionId) {
          return { response: status('Rejected') };
        }
        // §5.12: equivale a una parada local; el cargador para sin idTag propio.
        return { response: status('Accepted'), after: () => this.stopTransaction('Remote') };

      case 'Reset':
        if (test) return { response: status('Rejected') };
        if (req.graceful) {
          // 2.x OnIdle con transacción → Scheduled. 1.6 Soft: detiene con SoftReset y reinicia.
          if (!this.is16 && this.tx) {
            this.scheduledReset = true;
            return { response: status('Scheduled') };
          }
          return {
            response: status('Accepted'),
            after: async () => {
              if (this.tx) this.queueStop('SoftReset', undefined);
              await this.drainQueue();
              this.reboot('RemoteReset');
            },
          };
        }
        return {
          response: status('Accepted'),
          after: async () => {
            // 1.6 Hard: reinicia ya; el StopTransaction sale tras el próximo Boot Accepted (§5.14).
            // 2.x Immediate: termina la transacción (ImmediateReset) y reinicia.
            if (this.tx) this.queueStop('HardReset', undefined);
            if (!this.is16) await this.drainQueue();
            this.reboot('RemoteReset');
          },
        };

      case 'Unlock':
        if (req.connectorId !== CONNECTOR_ID) return { response: status(this.is16 ? 'NotSupported' : 'UnknownConnector') };
        if (test) return { response: status('UnlockFailed') };
        // 2.x: con transacción autorizada en curso NO se desbloquea.
        if (!this.is16 && this.tx) return { response: status('OngoingAuthorizedTransaction') };
        // §5.18 (1.6): si hay transacción, primero se termina (UnlockCommand).
        return { response: status('Unlocked'), after: () => this.stopTransaction('UnlockCommand') };

      case 'ChangeAvailability': {
        if (req.connectorId !== 0 && req.connectorId !== CONNECTOR_ID) return { response: status('Rejected') };
        if (test) return { response: status('Rejected') };
        const current = req.connectorId === 0 ? this.stationOperative : this.operative;
        // §5.2: si ya está en el estado pedido → Accepted.
        if (current === req.operative) return { response: status('Accepted') };
        if (this.tx) {
          this.scheduledAvailability = { connectorId: req.connectorId, operative: req.operative };
          this.emit();
          return { response: status('Scheduled') };
        }
        return {
          response: status('Accepted'),
          after: async () => {
            if (req.connectorId === 0) this.stationOperative = req.operative;
            this.operative = req.operative;
            await this.afterChange();
          },
        };
      }

      case 'Trigger':
        return this.handleTrigger(req.message, req.connectorId, test);

      case 'GetConfiguration': {
        const entries = this.cfg.entries('ocpp1.6');
        const wanted = req.keys?.length ? req.keys : undefined;
        const match = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
        const known = wanted ? entries.filter((e) => wanted.some((k) => match(k, e.name))) : entries;
        const unknown = wanted ? wanted.filter((k) => !entries.some((e) => match(k, e.name))) : [];
        return {
          response: {
            configurationKey: known.map((e) => ({ key: e.name, readonly: e.readonly, value: e.value })),
            ...(unknown.length ? { unknownKey: unknown } : {}),
          },
        };
      }

      case 'ChangeConfiguration': {
        const result = this.cfg.change('ocpp1.6', req.key, req.value, 'CSMS');
        return {
          response: status(result),
          after: result === 'Accepted' ? async () => this.applyConfigChange(req.key) : undefined,
        };
      }

      case 'GetVariables':
        return {
          response: {
            getVariableResult: req.items.map((it) => {
              const base = { component: { name: it.component }, variable: { name: it.variable } };
              if (it.attributeType && it.attributeType !== 'Actual') {
                return { ...base, attributeStatus: 'NotSupportedAttributeType', attributeType: it.attributeType };
              }
              const def = this.cfg.find(this.config.protocol, `${it.component}.${it.variable}`);
              if (!def) {
                return { ...base, attributeStatus: KNOWN_COMPONENTS.has(it.component) ? 'UnknownVariable' : 'UnknownComponent' };
              }
              return { ...base, attributeStatus: 'Accepted', attributeType: 'Actual', attributeValue: this.cfg.get(def.key) };
            }),
          },
        };

      case 'SetChargingProfile': {
        if (test) return { response: status('Rejected') };
        const r = this.smart.set(req.profile, this.smartLimits(), this.txContext());
        this.log(r.status === 'Accepted'
          ? `Perfil #${req.profile.id} (${req.profile.purpose}, stack ${req.profile.stackLevel}) instalado`
          : `SetChargingProfile rechazado: ${r.reason}`);
        return { response: status(r.status), after: async () => this.onSmartChange() };
      }

      case 'ClearChargingProfile': {
        const r = this.smart.clear(req);
        return { response: status(r), after: async () => this.onSmartChange() };
      }

      case 'GetCompositeSchedule': {
        if (req.connectorId < 0 || req.connectorId > CONNECTOR_ID || req.duration <= 0) {
          return { response: this.profile.compositeResult('Rejected', req.connectorId) };
        }
        const unit = req.unit ?? (this.config.chargerType === 'AC' ? 'A' : 'W');
        if (!this.smartLimits().allowedUnits.includes(unit)) return { response: this.profile.compositeResult('Rejected', req.connectorId) };
        const s = this.smart.composite(req.connectorId || CONNECTOR_ID, req.duration, unit, this.electrical(), this.physics.offeredW * this.physics.derate, this.txContext());
        return { response: this.profile.compositeResult('Accepted', req.connectorId, s) };
      }

      case 'SetVariables': {
        const changed: string[] = [];
        const results = req.items.map((it) => {
          const base = { component: { name: it.component }, variable: { name: it.variable } };
          if (it.attributeType && it.attributeType !== 'Actual') {
            return { ...base, attributeType: it.attributeType, attributeStatus: 'NotSupportedAttributeType' };
          }
          const name = `${it.component}.${it.variable}`;
          const r = this.cfg.change(this.config.protocol, name, it.value, 'CSMS');
          if (r === 'Accepted') changed.push(name);
          const attributeStatus =
            r === 'NotSupported' ? (KNOWN_COMPONENTS.has(it.component) ? 'UnknownVariable' : 'UnknownComponent') : r;
          return { ...base, attributeType: 'Actual', attributeStatus };
        });
        return {
          response: { setVariableResult: results },
          after: changed.length ? async () => changed.forEach((n) => this.applyConfigChange(n)) : undefined,
        };
      }
    }
  }

  /** §5.17: primero el .conf y luego el mensaje pedido, con información actual. */
  private handleTrigger(message: string, connectorId: number | undefined, test: boolean) {
    const reply = (s: string, after?: () => Promise<void>) => ({ response: { status: s }, after });
    if (connectorId !== undefined && connectorId !== 0 && connectorId !== CONNECTOR_ID) return reply('Rejected');
    if (test) return reply('Rejected');

    switch (message) {
      case 'BootNotification':
        // 2.x: si el boot ya fue aceptado, se rechaza.
        if (!this.is16 && this.bootStatus === 'Accepted') return reply('Rejected');
        return reply('Accepted', () => this.boot('Triggered', true));
      case 'Heartbeat':
        return reply('Accepted', () => this.heartbeat(true));
      case 'StatusNotification':
        // Sin connectorId = el cargador (0) y cada conector.
        return reply('Accepted', () => this.syncStatus(true, connectorId === undefined ? undefined : [connectorId]));
      case 'MeterValues':
        return reply('Accepted', async () => {
          // 1.6: measurands de MeterValuesSampledData. 2.x: AlignedDataCtrlr.Measurands.
          const list = this.cfg.list(this.is16 ? 'MeterValuesSampledData' : 'MeterValuesAlignedData');
          const targets = this.is16 && connectorId === undefined ? [0, CONNECTOR_ID] : [connectorId || CONNECTOR_ID];
          for (const c of targets) {
            const s = this.sample(list, 'Trigger', this.now());
            if (!s) continue;
            const txId = c === CONNECTOR_ID ? this.tx?.ref.transactionId : undefined;
            await this.callDirect(this.profile.meterValues(c, s, txId), { triggered: true });
          }
        });
      case 'TransactionEvent': {
        const tx = this.tx;
        if (this.is16 || !tx) return reply(this.is16 ? 'NotImplemented' : 'Rejected');
        return reply('Accepted', async () => {
          const at = this.now();
          const s = this.sample(this.cfg.list('MeterValuesSampledData'), 'Trigger', at);
          const out = this.profile.txUpdate({ ...tx.ref, seqNo: this.seqNo++, offline: false }, 'Trigger', at, s);
          if (out) await this.callDirect(out, { triggered: true });
        });
      }
      case 'DiagnosticsStatusNotification':
      case 'FirmwareStatusNotification':
      case 'LogStatusNotification': {
        const valid = message === 'FirmwareStatusNotification' || (message === 'LogStatusNotification') !== this.is16;
        if (!valid) return reply('NotImplemented');
        // Sin carga/actualización en curso: se informa Idle (solo por TriggerMessage, §4.4/§4.5).
        return reply('Accepted', async () => {
          await this.callDirect(this.profile.idleStatus(message), { triggered: true });
        });
      }
      default:
        return reply('NotImplemented');
    }
  }

  private async onSmartChange() {
    const before = this.status;
    this.recomputePower();
    if (this.status !== before) await this.afterChange();
    this.emit();
  }

  private applyConfigChange(name: string) {
    const key = this.cfg.find(this.config.protocol, name)?.key;
    if (key === 'MeterValueSampleInterval' || key === 'TxEndedInterval') this.restartTxTimers();
    if (key === 'ClockAlignedDataInterval') this.restartClockTimer();
    this.emit();
  }

  // ═══════════════════════════ Infraestructura ═══════════════════════════

  private stopAllTimers() {
    for (const t of [this.physicsTimer, this.heartbeatTimer, this.periodicTimer, this.endSampleTimer]) clearInterval(t);
    for (const t of [this.clockTimer, this.bootTimer, this.authTimer, this.reconnectTimer]) clearTimeout(t);
  }

  /** Acciones del dispositivo en serie (los mensajes salen en orden cronológico). */
  private enqueue(fn: () => Promise<unknown>) {
    this.actions = this.actions.then(fn).catch((e: Error) => this.fail(e.message));
  }

  private pushFrame(f: Omit<FrameEntry, 'seq'>) {
    this.frames = [{ ...f, seq: ++this.frameSeq }, ...this.frames].slice(0, MAX_FRAMES);
    this.emit();
  }

  private log(text: string) {
    this.pushFrame({ at: this.now(), dir: 'sys', kind: 'INFO', text });
  }

  private fail(message: string) {
    this.lastError = message;
    this.pushFrame({ at: this.now(), dir: 'sys', kind: 'INFO', text: message, error: true });
  }
}

/** Mismo host que el dashboard: Vite reenvía /ocpp al backend. */
export const defaultBaseUrl = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ocpp`;
