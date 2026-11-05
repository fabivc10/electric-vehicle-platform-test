import type {
  AuthorizationStatus,
  BootStatus,
  ChargePoint,
  ChargePointSnapshot,
  Connector,
  ConnectorStatus,
  MeterSample,
  ProtocolId,
  Transaction,
} from '@ev/shared';
import type { AuthorizationStrategy } from '../auth/AuthorizationStrategy.js';
import type { EventBus } from '../events/EventBus.js';
import type {
  ActivityRepository,
  ChargePointRepository,
  MeterRepository,
  SequenceGenerator,
  TransactionRepository,
} from '../ports/repositories.js';

export interface BootInfo {
  vendor?: string;
  model?: string;
  serialNumber?: string;
  firmwareVersion?: string;
}

export interface BootResult {
  status: BootStatus;
  intervalSec: number;
  currentTime: string;
}

export interface StatusInput {
  connectorId: number;
  status: ConnectorStatus;
  errorCode?: string;
  info?: string;
  timestamp?: string;
}

export interface StartTransactionInput {
  connectorId: number;
  idTag: string;
  /** Opcional: un TransactionEvent Started puede no traer medidas. */
  meterStartWh?: number;
  startedAt?: string;
  /** Solo si el protocolo lo trae (OCPP 2.x). Si falta, se genera uno secuencial. */
  transactionId?: string;
}

export interface StopTransactionInput {
  transactionId: string;
  meterStopWh?: number;
  stoppedAt?: string;
  reason?: string;
}

export type MeterInput = Omit<MeterSample, 'chargePointId' | 'timestamp'> & { timestamp?: string };

export interface ChargingServiceDeps {
  chargePoints: ChargePointRepository;
  transactions: TransactionRepository;
  meters: MeterRepository;
  activity: ActivityRepository;
  sequence: SequenceGenerator;
  authorization: AuthorizationStrategy;
  bus: EventBus;
  options: {
    heartbeatIntervalSec: number;
    bootPolicy: 'accept-all' | 'known-only';
    knownChargePoints: string[];
  };
}

const now = () => new Date().toISOString();

/**
 * Servicio de aplicación con la lógica de negocio de carga. Es el ÚNICO lugar que
 * modifica el estado de cargadores/transacciones. Recibe datos ya normalizados:
 * los handlers de OCPP 1.6, OCPP 2.x y MQTT lo llaman con el mismo contrato.
 */
export class ChargingService {
  constructor(private readonly deps: ChargingServiceDeps) {}

  // ───────────────────────── Ciclo de vida de conexión ─────────────────────────

  async connected(chargePointId: string, protocol: ProtocolId): Promise<ChargePoint> {
    return this.mutate(chargePointId, (cp) => {
      cp.protocol = protocol;
      cp.online = true;
      cp.connectedAt = now();
      cp.lastSeenAt = cp.connectedAt;
    }, protocol);
  }

  async disconnected(chargePointId: string): Promise<void> {
    await this.mutate(chargePointId, (cp) => {
      cp.online = false;
    });
  }

  /** Marca actividad en cualquier mensaje entrante (para "último latido"/presencia). */
  async touch(chargePointId: string): Promise<void> {
    const cp = await this.deps.chargePoints.get(chargePointId);
    if (!cp) return;
    cp.lastSeenAt = now();
    await this.deps.chargePoints.save(cp);
  }

  // ───────────────────────── Mensajes iniciados por el cargador ─────────────────

  async boot(chargePointId: string, info: BootInfo): Promise<BootResult> {
    const { bootPolicy, knownChargePoints, heartbeatIntervalSec } = this.deps.options;
    const status: BootStatus =
      bootPolicy === 'accept-all' || knownChargePoints.includes(chargePointId) ? 'Accepted' : 'Rejected';

    await this.mutate(chargePointId, (cp) => {
      Object.assign(cp, stripUndefined(info));
      cp.bootStatus = status;
      cp.heartbeatIntervalSec = heartbeatIntervalSec;
      // lastHeartbeatAt solo se actualiza con un Heartbeat real (no se inventa en el boot).
    });

    return { status, intervalSec: heartbeatIntervalSec, currentTime: now() };
  }

  async isRejected(chargePointId: string): Promise<boolean> {
    return (await this.deps.chargePoints.get(chargePointId))?.bootStatus === 'Rejected';
  }

  async heartbeat(chargePointId: string): Promise<string> {
    const at = now();
    await this.mutate(chargePointId, (cp) => {
      cp.lastHeartbeatAt = at;
    });
    return at;
  }

  async connectorStatus(chargePointId: string, input: StatusInput): Promise<void> {
    await this.mutate(chargePointId, (cp) => {
      const connector: Connector = {
        id: input.connectorId,
        status: input.status,
        errorCode: input.errorCode,
        info: input.info,
        updatedAt: input.timestamp ?? now(),
      };
      cp.connectors = [...cp.connectors.filter((c) => c.id !== input.connectorId), connector].sort(
        (a, b) => a.id - b.id,
      );
    });
  }

  async authorize(chargePointId: string, idTag: string): Promise<AuthorizationStatus> {
    const status = await this.deps.authorization.authorize(chargePointId, idTag);
    await this.mutate(chargePointId, (cp) => {
      cp.lastAuthorization = { idTag, status, at: now() };
    });
    return status;
  }

  async startTransaction(chargePointId: string, input: StartTransactionInput): Promise<Transaction> {
    const authorization = input.idTag
      ? await this.deps.authorization.authorize(chargePointId, input.idTag)
      : 'Accepted';
    const id = input.transactionId ?? String(await this.deps.sequence.next());

    const existing = await this.deps.transactions.get(chargePointId, id);
    if (existing) return existing; // Reintento idempotente del cargador (2.x).

    const active = (await this.activeTransactions(chargePointId)).filter((t) => t.connectorId === input.connectorId);
    // 1.6 no trae id propio: un StartTransaction repetido (reintento tras perder el .conf, §3.7)
    // se reconoce por sus campos y recibe el MISMO transactionId.
    const retry = active.find(
      (t) => t.idTag === input.idTag && t.meterStartWh === input.meterStartWh && t.startedAt === input.startedAt,
    );
    if (retry) return retry;
    // Un conector tiene una sola transacción: si el cargador inicia otra, la anterior quedó sin
    // StopTransaction (p. ej. se perdió al reiniciar). Se cierra sin inventar medidas ni motivo;
    // si el StopTransaction llega más tarde, lo sobrescribe con los datos reales.
    for (const stale of active) {
      Object.assign(stale, { state: 'completed', stoppedAt: input.startedAt ?? now(), stopReason: 'Sin StopTransaction' });
      await this.deps.transactions.save(stale);
      this.deps.bus.publish({ type: 'transaction', transaction: stale });
    }

    const tx: Transaction = {
      id,
      chargePointId,
      connectorId: input.connectorId,
      idTag: input.idTag,
      authorization,
      state: 'active',
      meterStartWh: input.meterStartWh,
      startedAt: input.startedAt ?? now(),
      energyWh: 0,
    };
    await this.deps.transactions.save(tx);
    this.deps.bus.publish({ type: 'transaction', transaction: tx });

    if (input.idTag) {
      await this.mutate(chargePointId, (cp) => {
        cp.lastAuthorization = { idTag: input.idTag, status: authorization, at: tx.startedAt };
      });
    }
    return tx;
  }

  async meterValues(chargePointId: string, input: MeterInput): Promise<MeterSample> {
    const active = input.transactionId
      ? await this.deps.transactions.get(chargePointId, input.transactionId)
      : (await this.activeTransactions(chargePointId)).find((tx) => tx.connectorId === input.connectorId);

    const sample: MeterSample = {
      ...stripUndefined(input),
      chargePointId,
      timestamp: input.timestamp ?? now(),
      transactionId: active?.state === 'active' ? active.id : input.transactionId,
    };
    await this.deps.meters.append(sample);
    this.deps.bus.publish({ type: 'meter', sample });

    if (active && active.state === 'active') {
      const merged: MeterSample = { ...active.lastMeter, ...sample };
      active.lastMeter = merged;
      if (sample.energyWh !== undefined) {
        // Sin meterStart (Started sin medidas): la primera lectura del registro es la base.
        active.meterStartWh ??= sample.energyWh;
        active.energyWh = Math.max(0, sample.energyWh - active.meterStartWh);
      }
      await this.deps.transactions.save(active);
      this.deps.bus.publish({ type: 'transaction', transaction: active });
    }
    return sample;
  }

  async stopTransaction(chargePointId: string, input: StopTransactionInput): Promise<Transaction | undefined> {
    const tx = await this.deps.transactions.get(chargePointId, input.transactionId);
    if (!tx) return undefined;

    const meterStopWh = input.meterStopWh ?? tx.lastMeter?.energyWh ?? (tx.meterStartWh ?? 0) + tx.energyWh;
    Object.assign(tx, {
      state: 'completed',
      meterStopWh,
      energyWh: tx.meterStartWh === undefined ? 0 : Math.max(0, meterStopWh - tx.meterStartWh),
      stoppedAt: input.stoppedAt ?? now(),
      stopReason: input.reason ?? 'Local',
    } satisfies Partial<Transaction>);
    await this.deps.transactions.save(tx);
    this.deps.bus.publish({ type: 'transaction', transaction: tx });
    return tx;
  }

  /** ChangeConfiguration/SetVariables aceptado: refleja lo que el CSMS conoce del equipo (§9.1.10). */
  async configurationChanged(chargePointId: string, key: string, value: string): Promise<void> {
    const name = key.toLowerCase();
    if (name !== 'heartbeatinterval' && name !== 'ocppcommctrlr.heartbeatinterval') return;
    const sec = Number.parseInt(value, 10);
    if (!Number.isFinite(sec) || sec < 0) return;
    await this.mutate(chargePointId, (cp) => {
      cp.heartbeatIntervalSec = sec;
    });
  }

  /** 2.x: el idToken puede llegar en un TransactionEvent posterior al Started (p. ej. cable antes que tarjeta). */
  async identifyTransaction(chargePointId: string, transactionId: string, idTag: string): Promise<void> {
    const tx = await this.deps.transactions.get(chargePointId, transactionId);
    if (!tx || tx.idTag) return;
    tx.idTag = idTag;
    tx.authorization = await this.deps.authorization.authorize(chargePointId, idTag);
    await this.deps.transactions.save(tx);
    this.deps.bus.publish({ type: 'transaction', transaction: tx });
  }

  // ───────────────────────── Consultas ─────────────────────────

  getChargePoint(id: string) {
    return this.deps.chargePoints.get(id);
  }

  listChargePoints() {
    return this.deps.chargePoints.list();
  }

  getTransaction(chargePointId: string, id: string) {
    return this.deps.transactions.get(chargePointId, id);
  }

  activeTransactions(chargePointId: string) {
    return this.deps.transactions.find({ chargePointId, state: 'active' });
  }

  findTransactions(filter: Parameters<TransactionRepository['find']>[0]) {
    return this.deps.transactions.find(filter);
  }

  meterHistory(chargePointId: string, limit = 120) {
    return this.deps.meters.history(chargePointId, limit);
  }

  async snapshot(chargePointId: string): Promise<ChargePointSnapshot | undefined> {
    const chargePoint = await this.deps.chargePoints.get(chargePointId);
    if (!chargePoint) return undefined;
    const [activeTransactions, meterHistory, activity] = await Promise.all([
      this.activeTransactions(chargePointId),
      this.deps.meters.history(chargePointId, 120),
      this.deps.activity.list(chargePointId, 50),
    ]);
    return { chargePoint, activeTransactions, meterHistory, activity };
  }

  async rename(chargePointId: string, name: string): Promise<ChargePoint | undefined> {
    if (!(await this.deps.chargePoints.get(chargePointId))) return undefined;
    return this.mutate(chargePointId, (cp) => {
      cp.name = name;
    });
  }

  /**
   * Borra un cargador desconectado con todo su historial (transacciones, medidas, eventos).
   * Si vuelve a conectarse con el mismo id, se registra de nuevo como el mismo cargador.
   */
  async forget(chargePointId: string): Promise<'removed' | 'online' | 'not-found'> {
    const cp = await this.deps.chargePoints.get(chargePointId);
    if (!cp) return 'not-found';
    if (cp.online) return 'online';
    await Promise.all([
      this.deps.chargePoints.remove(chargePointId),
      this.deps.transactions.removeByChargePoint(chargePointId),
      this.deps.meters.removeByChargePoint(chargePointId),
      this.deps.activity.removeByChargePoint(chargePointId),
    ]);
    this.deps.bus.publish({ type: 'chargePointRemoved', chargePointId });
    return 'removed';
  }

  // ───────────────────────── Interno ─────────────────────────

  /** Lee → modifica → guarda → publica. Crea el cargador si aún no existe. */
  private async mutate(
    chargePointId: string,
    change: (cp: ChargePoint) => void,
    protocol: ProtocolId = 'ocpp1.6',
  ): Promise<ChargePoint> {
    const cp = (await this.deps.chargePoints.get(chargePointId)) ?? {
      id: chargePointId,
      protocol,
      online: false,
      heartbeatIntervalSec: this.deps.options.heartbeatIntervalSec,
      connectors: [],
    };
    change(cp);
    await this.deps.chargePoints.save(cp);
    this.deps.bus.publish({ type: 'chargePoint', chargePoint: cp });
    return cp;
  }
}

const stripUndefined = <T extends object>(obj: T): T =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
