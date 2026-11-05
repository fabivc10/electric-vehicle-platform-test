import type { z } from 'zod';
import type { ChargingService } from '../../../core/services/ChargingService.js';

export interface HandlerContext {
  chargePointId: string;
  charging: ChargingService;
}

export interface HandlerOutcome {
  /** Payload del CALLRESULT. */
  response: Record<string, unknown>;
  /** Texto corto para el panel de eventos (p. ej. "Accepted", "18.4 kW", "#1042"). */
  summary: string;
  /** Descripción para el operador (panel Eventos). */
  message?: string;
  ok?: boolean;
}

/**
 * Command pattern: cada acción OCPP es un objeto independiente con su esquema y su lógica.
 * Agregar una acción = agregar una entrada al registro, sin tocar el dispatcher
 * (reemplaza la cadena if/else de ocpp_res_handler.js del proyecto original).
 */
export interface ActionHandler<S extends z.ZodType = z.ZodType> {
  readonly schema: S;
  // Firma de método (bivariante) para poder guardar handlers concretos en HandlerRegistry.
  handle(ctx: HandlerContext, payload: z.infer<S>): Promise<HandlerOutcome>;
}

export type HandlerRegistry = Readonly<Record<string, ActionHandler>>;

export const defineHandler = <S extends z.ZodType>(
  schema: S,
  handle: (ctx: HandlerContext, payload: z.infer<S>) => Promise<HandlerOutcome> | HandlerOutcome,
): ActionHandler<S> => ({
  schema,
  handle: async (ctx, payload) => handle(ctx, payload),
});
