import type { ConnectorStatus } from '@ev/shared';

export const STATUS_LABEL: Record<ConnectorStatus, string> = {
  Available: 'Disponible',
  Preparing: 'Preparando',
  Charging: 'Cargando',
  SuspendedEVSE: 'Pausado (cargador)',
  SuspendedEV: 'Pausado (vehículo)',
  Finishing: 'Finalizando',
  Reserved: 'Reservado',
  Unavailable: 'No disponible',
  Faulted: 'Falla',
};

export type Tone = 'ok' | 'info' | 'warn' | 'danger' | 'muted';

export const STATUS_TONE: Record<ConnectorStatus, Tone> = {
  Available: 'info',
  Preparing: 'info',
  Charging: 'ok',
  SuspendedEVSE: 'warn',
  SuspendedEV: 'warn',
  Finishing: 'info',
  Reserved: 'muted',
  Unavailable: 'muted',
  Faulted: 'danger',
};

/** Estados en los que hay un vehículo conectado al conector. */
export const PLUGGED = new Set<ConnectorStatus>(['Preparing', 'Charging', 'SuspendedEV', 'SuspendedEVSE', 'Finishing']);
