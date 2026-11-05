/** Error de aplicación con estado HTTP sugerido; la capa HTTP lo traduce a la respuesta. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
