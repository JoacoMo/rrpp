import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import type { Env } from '../config/env';

export type { Logger } from 'pino';

const SENSITIVE_KEYS = [
  'token',
  'apiKey',
  'password',
  'serviceRoleKey',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_JWT_SECRET',
  'ANTHROPIC_API_KEY',
] as const;

/** Rutas que pino reemplaza por "[REDACTED]" antes de escribir el log. */
export const REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  'headers["x-api-key"]',
  // El comodín de pino cubre un solo nivel: se listan la raíz y dos niveles de anidamiento
  ...SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]),
];

/**
 * Crea el logger raíz de la API. En development usa pino-pretty; en el resto, JSON por stdout.
 * `destination` permite capturar la salida (tests).
 */
export function createLogger(
  env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>,
  destination?: DestinationStream,
): Logger {
  const options: LoggerOptions = {
    level: env.LOG_LEVEL,
    base: { service: 'rrpp-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: [...REDACT_PATHS], censor: '[REDACTED]' },
  };

  if (destination !== undefined) return pino(options, destination);

  if (env.NODE_ENV === 'development') {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname,service',
        },
      },
    });
  }

  return pino(options);
}
