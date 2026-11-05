import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { type ChargingSlice, createChargingSlice } from './slices/chargingSlice';
import { type EmulatorSlice, createEmulatorSlice } from './slices/emulatorSlice';
import { type UiSlice, createUiSlice } from './slices/uiSlice';

export type AppState = ChargingSlice & UiSlice & EmulatorSlice;

/**
 * Store único compuesto por slices (patrón recomendado por Zustand).
 * Los componentes leen con selectores finos (`useAppStore((s) => s.x)`) o con los
 * hooks derivados de ./selectors.ts — nunca el store entero.
 */
export const useAppStore = create<AppState>()(
  devtools(
    (...a) => ({
      ...createChargingSlice(...a),
      ...createUiSlice(...a),
      ...createEmulatorSlice(...a),
    }),
    { name: 'ev-dashboard' },
  ),
);
