import type { StateCreator } from 'zustand';
import { EmulatedCharger } from '../../emulator/EmulatedCharger';
import type { EmulatorConfig, EmulatorSettings, EmulatorSnapshot } from '../../emulator/types';
import type { AppState } from '../index';

const STORAGE_KEY = 'ev-emulator';

type Persisted = { config?: Partial<EmulatorConfig>; settings?: Partial<EmulatorSettings> };

const load = (): Persisted => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Persisted;
  } catch {
    return {};
  }
};

const save = (s: EmulatorSnapshot) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ config: s.config, settings: s.settings }));
  } catch {
    /* almacenamiento no disponible: se ignora */
  }
};

/**
 * Cargador emulado en el navegador. El `EmulatedCharger` vive aquí (fuera de los
 * componentes) para que la conexión OCPP siga activa al cambiar de página.
 * Los componentes leen `emulator` (snapshot inmutable) y llaman a `emulatorDevice`.
 */
export interface EmulatorSlice {
  emulator: EmulatorSnapshot;
  emulatorDevice: EmulatedCharger;
}

export const createEmulatorSlice: StateCreator<AppState, [['zustand/devtools', never]], [], EmulatorSlice> = (set) => {
  const device = new EmulatedCharger(load(), (emulator) => {
    set({ emulator }, false, 'emulator/change');
    save(emulator);
  });
  return { emulator: device.snapshot(), emulatorDevice: device };
};
