import type { StateCreator } from 'zustand';
import type { AppState } from '../index';

export type View = 'session' | 'chargers' | 'history' | 'profiles' | 'emulator' | 'settings';

/** Estado puramente de interfaz (navegación y selección). */
export interface UiSlice {
  view: View;
  selectedId?: string;
  connectorId: number;
  setView(view: View): void;
  select(chargePointId: string): void;
  setConnector(connectorId: number): void;
}

const VIEWS: View[] = ['session', 'chargers', 'history', 'profiles', 'emulator', 'settings'];
/** La vista vive en el hash (#/perfiles…): el botón Atrás, recargar y compartir el enlace funcionan. */
const SLUG: Record<View, string> = { session: 'sesion', chargers: 'cargadores', history: 'historial', profiles: 'perfiles', emulator: 'emulador', settings: 'ajustes' };
const viewFromHash = (): View => {
  const slug = typeof location === 'undefined' ? '' : location.hash.replace(/^#\/?/, '');
  return VIEWS.find((v) => SLUG[v] === slug) ?? 'session';
};

export const createUiSlice: StateCreator<AppState, [['zustand/devtools', never]], [], UiSlice> = (set, get) => ({
  view: viewFromHash(),
  selectedId: undefined,
  connectorId: 1,
  setView: (view) => {
    if (typeof location !== 'undefined' && location.hash !== `#/${SLUG[view]}`) location.hash = `/${SLUG[view]}`;
    set({ view });
  },
  select: (selectedId) => {
    if (get().selectedId === selectedId) return;
    set({ selectedId, connectorId: 1 });
    void get().loadSnapshot(selectedId).catch(() => undefined);
  },
  setConnector: (connectorId) => set({ connectorId }),
});

/** Sincroniza Atrás/Adelante del navegador con la vista. */
export const bindHashNavigation = (setView: (v: View) => void) => {
  const onHash = () => setView(viewFromHash());
  window.addEventListener('hashchange', onHash);
  return () => window.removeEventListener('hashchange', onHash);
};
