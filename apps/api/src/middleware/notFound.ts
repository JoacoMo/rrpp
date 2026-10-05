import type { RequestHandler } from 'express';
import { AppError, ErrorCode } from '../lib/errors';

/** Cualquier ruta que no matcheó termina acá. */
export const notFound: RequestHandler = (req, _res, next) => {
  next(
    new AppError(ErrorCode.NOT_FOUND, {
      message: 'La ruta solicitada no existe.',
      details: { method: req.method, path: req.path },
    }),
  );
};
