import type { OcppProtocolId, OcppVersion } from './common/OcppVersion.js';
import { ocpp16 } from './v16/index.js';
import { ocpp201, ocpp21 } from './v201/index.js';

/**
 * Factory/Registry de versiones OCPP según el subprotocolo WebSocket negociado.
 * Para soportar una versión nueva: crear su carpeta (handlers + commands) y registrarla aquí.
 */
const VERSIONS: Record<OcppProtocolId, OcppVersion> = {
  'ocpp1.6': ocpp16,
  'ocpp2.0.1': ocpp201,
  'ocpp2.1': ocpp21,
};

/** Orden de preferencia cuando el cargador ofrece varios subprotocolos. */
export const SUPPORTED_SUBPROTOCOLS: OcppProtocolId[] = ['ocpp2.1', 'ocpp2.0.1', 'ocpp1.6'];

export const isSupportedSubprotocol = (value: string): value is OcppProtocolId => value in VERSIONS;

export const getOcppVersion = (protocol: OcppProtocolId): OcppVersion => VERSIONS[protocol];

/** Elige el subprotocolo a usar a partir de los ofrecidos por el cliente. */
export const negotiateSubprotocol = (offered: Iterable<string>): OcppProtocolId | undefined => {
  const set = new Set([...offered].map((p) => p.trim().toLowerCase()));
  return SUPPORTED_SUBPROTOCOLS.find((p) => set.has(p));
};
