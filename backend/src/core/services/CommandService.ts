import type { ChargePointCommand, CommandResult } from '@ev/shared';
import { AppError } from '../errors.js';
import type { ConnectionRegistry } from './ConnectionRegistry.js';
import type { ChargingService } from './ChargingService.js';

/**
 * Facade para enviar comandos a cargadores. La API HTTP (o cualquier otro consumidor)
 * no sabe si el cargador habla OCPP 1.6, 2.x o MQTT: la conexión registrada traduce.
 */
export class CommandService {
  constructor(
    private readonly connections: ConnectionRegistry,
    private readonly charging: ChargingService,
  ) {}

  async execute(chargePointId: string, command: ChargePointCommand): Promise<CommandResult> {
    const connection = this.connections.get(chargePointId);
    if (!connection) throw new AppError(409, 'CHARGE_POINT_OFFLINE', `El cargador ${chargePointId} no está conectado`);
    // §4.2: con BootNotification Rejected el Central System no debe iniciar mensajes (y el cargador no respondería).
    if ((await this.charging.getChargePoint(chargePointId))?.bootStatus === 'Rejected') {
      throw new AppError(409, 'CHARGE_POINT_REJECTED', `El cargador ${chargePointId} fue rechazado en BootNotification`);
    }

    if (command.type === 'RemoteStop') {
      const tx = await this.charging.getTransaction(chargePointId, command.transactionId);
      if (!tx || tx.state !== 'active') {
        throw new AppError(404, 'TRANSACTION_NOT_ACTIVE', `La transacción ${command.transactionId} no está activa`);
      }
    }

    const result = await connection.execute(command);
    if (command.type === 'ChangeConfiguration' && result.accepted) {
      await this.charging.configurationChanged(chargePointId, command.key, command.value);
    }
    return result;
  }
}
