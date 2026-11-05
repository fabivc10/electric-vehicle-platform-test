/**
 * Textos para personas del panel "Eventos OCPP". El nombre técnico de la acción y su
 * resumen se guardan aparte (action/summary); esto es lo que lee un operador.
 */

const STATUS: Record<string, string> = {
  Available: 'disponible',
  Preparing: 'preparando la carga',
  Charging: 'cargando',
  SuspendedEV: 'en pausa por el vehículo',
  SuspendedEVSE: 'en pausa por el cargador',
  Finishing: 'carga terminada, falta retirar el cable',
  Reserved: 'reservado',
  Unavailable: 'fuera de servicio',
  Faulted: 'con falla',
  Occupied: 'en uso',
};

/** ChargePointErrorCode §7.6 */
const ERROR: Record<string, string> = {
  ConnectorLockFailure: 'no se pudo bloquear o desbloquear el conector',
  EVCommunicationError: 'se perdió la comunicación con el vehículo',
  GroundFailure: 'saltó la protección diferencial (falla a tierra)',
  HighTemperature: 'temperatura interna demasiado alta',
  InternalError: 'error interno de hardware o software',
  LocalListConflict: 'conflicto con la lista local de tarjetas',
  OtherError: 'otra falla del equipo',
  OverCurrentFailure: 'saltó la protección por sobrecorriente',
  OverVoltage: 'tensión de red demasiado alta',
  PowerMeterFailure: 'no se puede leer el medidor',
  PowerSwitchFailure: 'falla del contactor de potencia',
  ReaderFailure: 'falla del lector de tarjetas',
  ResetFailure: 'no se pudo reiniciar',
  UnderVoltage: 'tensión de red demasiado baja',
  WeakSignal: 'señal de comunicación débil',
};

/** Reason §7.36 / stoppedReason de 2.x */
const REASON: Record<string, string> = {
  Local: 'detenida en el cargador',
  Remote: 'detenida desde el sistema',
  EVDisconnected: 'se desconectó el vehículo',
  DeAuthorized: 'la tarjeta dejó de estar autorizada',
  EmergencyStop: 'parada de emergencia',
  HardReset: 'reinicio completo del cargador',
  SoftReset: 'reinicio del cargador',
  Reboot: 'el cargador se reinició',
  PowerLoss: 'corte de energía',
  UnlockCommand: 'se desbloqueó el conector',
  Other: 'otro motivo',
  StoppedByEV: 'la detuvo el vehículo',
  Timeout: 'se agotó el tiempo de espera',
  ImmediateReset: 'reinicio inmediato del cargador',
  EnergyLimitReached: 'se alcanzó el límite de energía',
  GroundFault: 'falla a tierra',
  OvercurrentFault: 'sobrecorriente',
  TimeLimitReached: 'se alcanzó el límite de tiempo',
  MasterPass: 'detenida con tarjeta maestra',
  LocalOutOfCredit: 'sin saldo',
  SOCLimitReached: 'el vehículo llegó al SoC objetivo',
  PowerQuality: 'mala calidad de la red eléctrica',
};

const AUTH: Record<string, string> = {
  Accepted: 'autorizada',
  Blocked: 'bloqueada',
  Expired: 'vencida',
  Invalid: 'no válida',
  ConcurrentTx: 'ya está en otra carga',
  Unknown: 'desconocida',
  NoCredit: 'sin saldo',
  NotAllowedTypeEVSE: 'no permitida en este cargador',
  NotAtThisLocation: 'no permitida en esta ubicación',
  NotAtThisTime: 'no permitida a esta hora',
};

const BOOT: Record<string, string> = {
  Accepted: 'El cargador se conectó y quedó registrado',
  Pending: 'El cargador espera la aprobación del sistema',
  Rejected: 'Se rechazó el registro del cargador',
};

export const where = (connectorId: number) => (connectorId === 0 ? 'Cargador' : `Conector ${connectorId}`);

export const statusText = (connectorId: number, status: string, errorCode?: string, info?: string) => {
  const base = `${where(connectorId)}: ${STATUS[status] ?? status}`;
  const err = errorCode && errorCode !== 'NoError' ? ERROR[errorCode] ?? errorCode : undefined;
  const parts = [base];
  if (err) parts.push(status === 'Faulted' ? err : `aviso: ${err}`);
  if (info) parts.push(info);
  return parts.join(' · ');
};

export const bootText = (status: string) => BOOT[status] ?? `Registro: ${status}`;
export const authText = (idTag: string, status: string) => `Tarjeta ${idTag} ${AUTH[status] ?? status}`;
export const reasonText = (reason?: string) => REASON[reason ?? 'Local'] ?? reason ?? '';
export const kwhText = (wh: number) => `${(wh / 1000).toLocaleString('es', { maximumFractionDigits: 2 })} kWh`;

export const readingText = (r: { powerW?: number; energyWh?: number; socPercent?: number }) => {
  const parts: string[] = [];
  if (r.powerW !== undefined) parts.push(`${(r.powerW / 1000).toLocaleString('es', { maximumFractionDigits: 1 })} kW`);
  if (r.socPercent !== undefined) parts.push(`batería ${Math.round(r.socPercent)} %`);
  if (r.energyWh !== undefined && !parts.length) parts.push(`medidor ${kwhText(r.energyWh)}`);
  return parts.length ? `Lectura del medidor: ${parts.join(' · ')}` : 'Lectura del medidor';
};

const RPC_ERROR: Record<string, string> = {
  NotImplemented: 'el sistema no conoce ese mensaje',
  NotSupported: 'el sistema no soporta ese mensaje',
  SecurityError: 'el cargador no está autorizado a enviar mensajes',
  FormatViolation: 'el mensaje está mal formado',
  OccurrenceConstraintViolation: 'falta un dato obligatorio',
  TypeConstraintViolation: 'un dato tiene el tipo incorrecto',
  PropertyConstraintViolation: 'un dato está fuera de rango o es demasiado largo',
  InternalError: 'error interno del sistema',
};
export const rpcErrorText = (kind: string) => `Mensaje rechazado: ${RPC_ERROR[kind] ?? kind}`;

const COMMAND: Record<string, string> = {
  RemoteStart: 'iniciar carga',
  RemoteStop: 'detener carga',
  Reset: 'reiniciar',
  UnlockConnector: 'desbloquear conector',
  ChangeAvailability: 'cambiar disponibilidad',
  TriggerMessage: 'pedir un mensaje',
  GetConfiguration: 'leer configuración',
  ChangeConfiguration: 'cambiar configuración',
  SetChargingProfile: 'instalar perfil de carga',
  ClearChargingProfile: 'borrar perfiles de carga',
  GetCompositeSchedule: 'consultar límite programado',
  Raw: 'mensaje manual',
};
const RESULT: Record<string, string> = {
  Accepted: 'aceptada',
  Rejected: 'rechazada',
  Scheduled: 'se aplicará al terminar la carga',
  Unlocked: 'desbloqueado',
  UnlockFailed: 'no se pudo desbloquear',
  NotSupported: 'no soportada',
  RebootRequired: 'aceptada, requiere reinicio',
  OK: 'respondida',
  Timeout: 'sin respuesta del cargador',
  Unknown: 'no había perfiles que coincidan',
};
export const commandText = (type: string, status: string, detail?: string) =>
  `Orden "${COMMAND[type] ?? type}"${detail ? ` (${detail})` : ''}: ${RESULT[status] ?? status}`;
