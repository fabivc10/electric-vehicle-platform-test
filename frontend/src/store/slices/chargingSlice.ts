import type {
  ActivityEntry,
  ChargePoint,
  ChargePointCommand,
  CommandResult,
  LiveEvent,
  MeterSample,
  Transaction,
} from '@ev/shared';
import type { StateCreator } from 'zustand';
import { api } from '../../api/http';
import type { LiveStatus } from '../../api/liveSocket';
import type { AppState } from '../index';

const MAX_METERS = 240;
const MAX_ACTIVITY = 60;

/** Datos que vienen del backend (REST + eventos en vivo). */
export interface ChargingSlice {
  chargePoints: Record<string, ChargePoint>;
  /** Transacciones activas por cargador. */
  activeTransactions: Record<string, Transaction[]>;
  meters: Record<string, MeterSample[]>;
  /** Más recientes primero. */
  activity: Record<string, ActivityEntry[]>;
  history: Transaction[];
  liveStatus: LiveStatus;

  loadChargePoints(): Promise<void>;
  loadSnapshot(chargePointId: string): Promise<void>;
  loadHistory(): Promise<void>;
  applyLiveEvent(event: LiveEvent): void;
  setLiveStatus(status: LiveStatus): void;
  sendCommand(command: ChargePointCommand): Promise<CommandResult>;
  renameChargePoint(name: string): Promise<void>;
  /** Borra cargadores desconectados (y su historial) del CSMS. */
  removeChargePoints(ids: string[]): Promise<void>;
}

const upsertTx = (list: Transaction[], tx: Transaction) => [tx, ...list.filter((t) => t.id !== tx.id)];

export const createChargingSlice: StateCreator<AppState, [['zustand/devtools', never]], [], ChargingSlice> = (set, get) => ({
  chargePoints: {},
  activeTransactions: {},
  meters: {},
  activity: {},
  history: [],
  liveStatus: 'connecting',

  async loadChargePoints() {
    const list = await api.listChargePoints();
    set({ chargePoints: Object.fromEntries(list.map((cp) => [cp.id, cp])) });
    const { selectedId, select } = get();
    if (!selectedId || !list.some((cp) => cp.id === selectedId)) {
      const first = list.find((cp) => cp.online) ?? list[0];
      if (first) select(first.id);
    }
  },

  async loadSnapshot(chargePointId) {
    const snap = await api.snapshot(chargePointId);
    set((s) => ({
      chargePoints: { ...s.chargePoints, [chargePointId]: snap.chargePoint },
      activeTransactions: { ...s.activeTransactions, [chargePointId]: snap.activeTransactions },
      meters: { ...s.meters, [chargePointId]: snap.meterHistory },
      activity: { ...s.activity, [chargePointId]: snap.activity },
    }));
  },

  async loadHistory() {
    set({ history: await api.transactions({ limit: 200 }) });
  },

  applyLiveEvent(event) {
    switch (event.type) {
      case 'chargePoint': {
        const cp = event.chargePoint;
        set((s) => ({ chargePoints: { ...s.chargePoints, [cp.id]: cp } }));
        if (!get().selectedId) get().select(cp.id);
        return;
      }
      case 'transaction': {
        const tx = event.transaction;
        set((s) => {
          const current = s.activeTransactions[tx.chargePointId] ?? [];
          const active =
            tx.state === 'active' ? upsertTx(current, tx) : current.filter((t) => t.id !== tx.id);
          return {
            activeTransactions: { ...s.activeTransactions, [tx.chargePointId]: active },
            history: upsertTx(s.history, tx),
          };
        });
        return;
      }
      case 'meter': {
        const m = event.sample;
        set((s) => ({
          meters: { ...s.meters, [m.chargePointId]: [...(s.meters[m.chargePointId] ?? []), m].slice(-MAX_METERS) },
        }));
        return;
      }
      case 'chargePointRemoved': {
        const id = event.chargePointId;
        set((s) => {
          const drop = <T,>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).filter(([k]) => k !== id));
          return {
            chargePoints: drop(s.chargePoints),
            activeTransactions: drop(s.activeTransactions),
            meters: drop(s.meters),
            activity: drop(s.activity),
            history: s.history.filter((t) => t.chargePointId !== id),
          };
        });
        if (get().selectedId === id) {
          const next = Object.values(get().chargePoints).find((cp) => cp.online) ?? Object.values(get().chargePoints)[0];
          if (next) get().select(next.id);
        }
        return;
      }
      case 'activity': {
        const e = event.entry;
        set((s) => ({
          activity: {
            ...s.activity,
            [e.chargePointId]: [e, ...(s.activity[e.chargePointId] ?? [])].slice(0, MAX_ACTIVITY),
          },
        }));
        return;
      }
    }
  },

  setLiveStatus(liveStatus) {
    set({ liveStatus });
  },

  async sendCommand(command) {
    const id = get().selectedId;
    if (!id) throw new Error('No hay cargador seleccionado');
    return api.command(id, command);
  },

  async removeChargePoints(ids) {
    // El evento chargePointRemoved actualiza el store (también en otras pestañas).
    await Promise.all(ids.map((id) => api.remove(id)));
  },

  async renameChargePoint(name) {
    const id = get().selectedId;
    if (!id) return;
    const cp = await api.rename(id, name);
    set((s) => ({ chargePoints: { ...s.chargePoints, [id]: cp } }));
  },
});
