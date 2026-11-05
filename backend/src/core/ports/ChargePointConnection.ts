import type { ChargePointCommand, CommandResult, ProtocolId } from '@ev/shared';

/**
 * Puerto de salida hacia un cargador conectado. Cada protocolo lo implementa
 * (OcppRpcConnection, MqttChargePointConnection) y el resto del sistema
 * envía comandos sin saber qué protocolo hay detrás.
 */
export interface ChargePointConnection {
  readonly chargePointId: string;
  readonly protocol: ProtocolId;
  execute(command: ChargePointCommand): Promise<CommandResult>;
  close(reason?: string): void;
}
