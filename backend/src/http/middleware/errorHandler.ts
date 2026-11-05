import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../../core/errors.js';
import type { Logger } from '../../shared/logger.js';

export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Ruta no encontrada: ${req.method} ${req.path}` } });
};

export const errorHandler =
  (logger: Logger): ErrorRequestHandler =>
  (err, req, res, _next) => {
    if (err instanceof ZodError) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Cuerpo inválido', details: err.issues },
      });
      return;
    }
    if (err instanceof AppError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }
    logger.error(`${req.method} ${req.originalUrl}`, err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Error interno' } });
  };
