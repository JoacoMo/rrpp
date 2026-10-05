import type { PostgrestError } from '@supabase/supabase-js';

export const ErrorCode = {
  // Genéricos
  BAD_REQUEST: 'BAD_REQUEST',
  INVALID_JSON: 'INVALID_JSON',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  REFERENCE_NOT_FOUND: 'REFERENCE_NOT_FOUND',
  CONSTRAINT_VIOLATION: 'CONSTRAINT_VIOLATION',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  // De dominio: los lanzan las funciones de Postgres como P0001 con el código como mensaje
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  ITEM_NOT_FOUND: 'ITEM_NOT_FOUND',
  ITEM_NOT_CLAIMED: 'ITEM_NOT_CLAIMED',
  PROSPECT_NOT_FOUND: 'PROSPECT_NOT_FOUND',
  EVENT_NOT_FOUND: 'EVENT_NOT_FOUND',
  ICEBREAKER_NOT_FOUND: 'ICEBREAKER_NOT_FOUND',
  JOB_NOT_FOUND: 'JOB_NOT_FOUND',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  SCAN_NOT_FOUND: 'SCAN_NOT_FOUND',
  SCAN_NOT_UPLOADING: 'SCAN_NOT_UPLOADING',
  SCAN_INCOMPLETE: 'SCAN_INCOMPLETE',
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ErrorDefinition {
  readonly status: number;
  readonly message: string;
}

export const ERROR_CATALOG: Readonly<Record<ErrorCode, ErrorDefinition>> = {
  BAD_REQUEST: { status: 400, message: 'La solicitud no es válida.' },
  INVALID_JSON: { status: 400, message: 'El cuerpo de la solicitud no es un JSON válido.' },
  UNAUTHORIZED: { status: 401, message: 'Falta la autenticación o no es válida.' },
  FORBIDDEN: { status: 403, message: 'No tenés permiso para hacer esto.' },
  NOT_FOUND: { status: 404, message: 'No encontramos lo que buscás.' },
  CONFLICT: { status: 409, message: 'Ya existe un registro con esos datos.' },
  PAYLOAD_TOO_LARGE: { status: 413, message: 'El cuerpo de la solicitud es demasiado grande.' },
  UNSUPPORTED_MEDIA_TYPE: {
    status: 415,
    message: 'El formato del cuerpo de la solicitud no está soportado.',
  },
  VALIDATION_ERROR: { status: 422, message: 'Hay datos inválidos en la solicitud.' },
  REFERENCE_NOT_FOUND: { status: 422, message: 'Hace referencia a algo que no existe.' },
  CONSTRAINT_VIOLATION: { status: 422, message: 'Los datos no cumplen las reglas permitidas.' },
  RATE_LIMITED: {
    status: 429,
    message: 'Hiciste demasiadas solicitudes. Esperá un rato y probá de nuevo.',
  },
  INTERNAL: {
    status: 500,
    message: 'Ocurrió un error inesperado. Probá de nuevo en unos minutos.',
  },
  SERVICE_UNAVAILABLE: {
    status: 503,
    message: 'El servicio no está disponible en este momento. Probá de nuevo en unos minutos.',
  },
  ACCOUNT_NOT_FOUND: { status: 404, message: 'No encontramos la cuenta de Instagram.' },
  ITEM_NOT_FOUND: { status: 404, message: 'No encontramos ese perfil en la carga.' },
  ITEM_NOT_CLAIMED: {
    status: 409,
    message: 'Ese perfil no está asignado a este worker o ya se liberó.',
  },
  PROSPECT_NOT_FOUND: { status: 404, message: 'No encontramos el prospecto.' },
  EVENT_NOT_FOUND: { status: 404, message: 'No encontramos el evento.' },
  ICEBREAKER_NOT_FOUND: { status: 404, message: 'No encontramos el mensaje de apertura.' },
  JOB_NOT_FOUND: { status: 404, message: 'No encontramos la carga.' },
  INVALID_TRANSITION: { status: 409, message: 'Ese cambio de estado no está permitido.' },
  SCAN_NOT_FOUND: { status: 404, message: 'No encontramos el escaneo.' },
  SCAN_NOT_UPLOADING: { status: 409, message: 'El escaneo ya no está recibiendo partes.' },
  SCAN_INCOMPLETE: { status: 409, message: 'Faltan partes del escaneo para poder cerrarlo.' },
  INVALID_ARGUMENT: { status: 422, message: 'Algún dato enviado no es válido.' },
};

/** Códigos que las funciones de Postgres lanzan con `raise exception '<CODIGO>'` (SQLSTATE P0001). */
export const DOMAIN_ERROR_CODES = [
  ErrorCode.ACCOUNT_NOT_FOUND,
  ErrorCode.ITEM_NOT_FOUND,
  ErrorCode.ITEM_NOT_CLAIMED,
  ErrorCode.PROSPECT_NOT_FOUND,
  ErrorCode.EVENT_NOT_FOUND,
  ErrorCode.ICEBREAKER_NOT_FOUND,
  ErrorCode.JOB_NOT_FOUND,
  ErrorCode.INVALID_TRANSITION,
  ErrorCode.SCAN_NOT_FOUND,
  ErrorCode.SCAN_NOT_UPLOADING,
  ErrorCode.SCAN_INCOMPLETE,
  ErrorCode.INVALID_ARGUMENT,
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

const domainErrorCodes: ReadonlySet<string> = new Set(DOMAIN_ERROR_CODES);

export function isDomainErrorCode(value: string): value is DomainErrorCode {
  return domainErrorCodes.has(value);
}

export interface AppErrorOptions {
  /** Mensaje para el usuario; por defecto, el del catálogo. */
  message?: string;
  /** Datos extra que se devuelven al cliente (solo si el error es expuesto). */
  details?: unknown;
  /** Error original, para los logs. Nunca se devuelve al cliente. */
  cause?: unknown;
  /** Si el mensaje y los detalles se pueden mostrar al cliente; por defecto, solo en 4xx. */
  expose?: boolean;
}

export class AppError extends Error {
  override readonly name = 'AppError';
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;
  readonly expose: boolean;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    const definition = ERROR_CATALOG[code];
    super(
      options.message ?? definition.message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.code = code;
    this.status = definition.status;
    this.details = options.details;
    this.expose = options.expose ?? definition.status < 500;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

const POSTGREST_CODE_MAP: Readonly<Record<string, ErrorCode>> = {
  PGRST116: ErrorCode.NOT_FOUND, // .single() sin filas
  '23505': ErrorCode.CONFLICT, // unique_violation
  '23503': ErrorCode.REFERENCE_NOT_FOUND, // foreign_key_violation
  '23514': ErrorCode.CONSTRAINT_VIOLATION, // check_violation
  '22P02': ErrorCode.BAD_REQUEST, // invalid_text_representation (ej. uuid mal formado)
};

/** Traduce un error de PostgREST/Postgres a un AppError con código propio. */
export function fromPostgrestError(
  error: Pick<PostgrestError, 'code' | 'message' | 'details' | 'hint'>,
): AppError {
  if (error.code === 'P0001') {
    const domainCode = error.message.trim();
    if (isDomainErrorCode(domainCode)) {
      return new AppError(domainCode, { details: parseDetails(error.details), cause: error });
    }
    return new AppError(ErrorCode.INTERNAL, { cause: error });
  }

  const mapped = POSTGREST_CODE_MAP[error.code];
  if (mapped !== undefined) return new AppError(mapped, { cause: error });

  return new AppError(ErrorCode.INTERNAL, { cause: error });
}

// Las funciones de la base pueden mandar el detalle como JSON (`using detail = json_build_object(...)`)
function parseDetails(details: string | null | undefined): unknown {
  if (details === null || details === undefined || details.trim() === '') return undefined;
  const trimmed = details.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return details;
    }
  }
  return details;
}
