/**
 * Adapter de entrada: cada protocolo (OCPP sobre WebSocket, MQTT, ...) implementa
 * un gateway que traduce su transporte al ChargingService y registra sus conexiones
 * en el ConnectionRegistry. main.ts los arranca/detiene de forma uniforme.
 */
export interface ProtocolGateway {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}
