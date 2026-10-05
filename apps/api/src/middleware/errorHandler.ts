import { inspect } from 'node:util';
import type { ErrorRequestHandler, Request } from 'express';
import { z } from 'zod';
import { AppError, ERROR_CATALOG, ErrorCode, isAppError } from '../lib/errors';
import { getRequestId } from './requestId';

/** Forma única de los errores de la API. */
export interface ErrorResponseBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

export interface ErrorHandlerOptions {
  /** Agrega mensaje y stack de los errores no expuestos (500). Solo para desarrollo. */
  exposeInternalErrors: boolean;
}

const STATUS_TO_CODE: Readonly<Partial<Record<number, ErrorCode>>> = {
  400: ErrorCode.BAD_REQUEST,
  401: ErrorCode.UNAUTHORIZED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  413: ErrorCode.PAYLOAD_TOO_LARGE,
  415: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
  422: ErrorCode.VALIDATION_ERROR,
  429: ErrorCode.RATE_LIMITED,
  503: ErrorCode.SERVICE_UNAVAILABLE,
};

interface HttpErrorInfo {
  status: number;
  type: string | undefined;
  limit: number | undefined;
}

// Errores con status de Express, body-parser y http-errors
function readHttpError(error: unknown): HttpErrorInfo | null {
  if (!(error instanceof Error)) return null;
  const status =
    'status' in error && typeof error.status === 'number'
      ? error.status
      : 'statusCode' in error && typeof error.statusCode === 'number'
        ? error.statusCode
        : undefined;
  if (status === undefined || status < 400 || status > 599) return null;
  return {
    status,
    type: 'type' in error && typeof error.type === 'string' ? error.type : undefined,
    limit: 'limit' in error && typeof error.limit === 'number' ? error.limit : undefined,
  };
}

/** Normaliza cualquier error lanzado a un AppError. */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;

  if (error instanceof z.core.$ZodError) {
    return new AppError(ErrorCode.VALIDATION_ERROR, {
      details: z.flattenError(error),
      cause: error,
    });
  }

  const http = readHttpError(error);
  if (http !== null) {
    if (http.type === 'entity.parse.failed') {
      return new AppError(ErrorCode.INVALID_JSON, { cause: error });
    }
    const code =
      STATUS_TO_CODE[http.status] ??
      (http.status < 500 ? ErrorCode.BAD_REQUEST : ErrorCode.INTERNAL);
    const details =
      code === ErrorCode.PAYLOAD_TOO_LARGE && http.limit !== undefined
        ? { limitBytes: http.limit }
        : undefined;
    return new AppError(code, { cause: error, details });
  }

  return new AppError(ErrorCode.INTERNAL, { cause: error });
}

function describeForDebug(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack?.split('\n') };
  }
  return { value: inspect(error, { depth: 2 }) };
}

function logError(req: Request, appError: AppError, original: unknown): void {
  const context = { code: appError.code, status: appError.status };
  if (appError.status >= 500) {
    req.log.error({ ...context, err: appError.cause ?? original }, 'request failed');
    return;
  }
  const level = [401, 403, 429].includes(appError.status) ? 'warn' : 'info';
  req.log[level](context, 'request rejected');
}

export function createErrorHandler({
  exposeInternalErrors,
}: ErrorHandlerOptions): ErrorRequestHandler {
  return (error: unknown, req, res, next) => {
    // Si ya se empezó a mandar la respuesta, Express corta la conexión
    if (res.headersSent) {
      next(error);
      return;
    }

    const appError = toAppError(error);
    logError(req, appError, error);

    let details: unknown;
    if (appError.expose) details = appError.details;
    else if (exposeInternalErrors)
      details = { debug: describeForDebug(appError.cause ?? appError) };

    const body: ErrorResponseBody = {
      error: {
        code: appError.code,
        // Los errores no expuestos nunca muestran su mensaje interno
        message: appError.expose ? appError.message : ERROR_CATALOG[appError.code].message,
        ...(details === undefined ? {} : { details }),
        requestId: getRequestId(req),
      },
    };
    res.status(appError.status).json(body);
  };
}
