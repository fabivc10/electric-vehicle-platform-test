import type { ChargePointConnection } from '../ports/ChargePointConnection.js';

/**
 * Registro de conexiones vivas (reemplaza al singleton EVSEHandler del proyecto original:
 * se crea una vez en el composition root y se inyecta).
 */
export class ConnectionRegistry {
  private readonly connections = new Map<string, ChargePointConnection>();

  /** Registra la conexión; si el cargador ya tenía una, la anterior se cierra. */
  register(connection: ChargePointConnection): void {
    const previous = this.connections.get(connection.chargePointId);
    this.connections.set(connection.chargePointId, connection);
    if (previous && previous !== connection) previous.close('Reemplazada por una nueva conexión');
  }

  /**
   * Quita la conexión solo si sigue siendo la registrada (evita que el cierre tardío
   * de un socket viejo desconecte al nuevo). Devuelve true si se quitó.
   */
  unregister(connection: ChargePointConnection): boolean {
    if (this.connections.get(connection.chargePointId) !== connection) return false;
    this.connections.delete(connection.chargePointId);
    return true;
  }

  get(chargePointId: string): ChargePointConnection | undefined {
    return this.connections.get(chargePointId);
  }

  ids(): string[] {
    return [...this.connections.keys()];
  }
}
