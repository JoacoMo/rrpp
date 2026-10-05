import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { z } from 'zod';
import { es } from 'zod/locales';
import packageJson from '../package.json' with { type: 'json' };
import type { Env } from './config/env';
import type { Logger } from './lib/logger';
import type { PingResult } from './lib/supabase';
import { createErrorHandler } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';
import { REQUEST_ID_HEADER, genReqId } from './middleware/requestId';
import { createHealthRouter } from './modules/health/health.routes';

export const APP_VERSION = packageJson.version;

export const JSON_BODY_LIMIT = '1mb';

const PROBE_PATHS = new Set(['/healthz', '/readyz']);

export interface AppDeps {
  env: Env;
  logger: Logger;
  checks: {
    database: () => Promise<PingResult>;
  };
}

export function createApp({ env, logger, checks }: AppDeps): Express {
  // Mensajes de validación de zod en español para las respuestas de la API
  z.config(es());

  const isDevelopment = env.NODE_ENV === 'development';
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY > 0 ? env.TRUST_PROXY : false);

  app.use(
    pinoHttp({
      logger,
      genReqId,
      customLogLevel: (req, res, error) => {
        if (error !== undefined || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'info';
        // Los sondeos del balanceador que salen bien no ensucian los logs
        if (req.url !== undefined && PROBE_PATHS.has(req.url)) return 'silent';
        return 'info';
      },
      serializers: {
        // Los headers de respuesta (helmet, etag) no aportan nada en el log de acceso
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  app.use(helmet());

  const allowedOrigins = new Set(env.CORS_ORIGINS);
  app.use(
    cors({
      // Origen no permitido: sin headers CORS (el navegador lo bloquea), nunca un 500
      origin: (origin, callback) => {
        callback(null, origin !== undefined && allowedOrigins.has(origin));
      },
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type', REQUEST_ID_HEADER],
      exposedHeaders: [REQUEST_ID_HEADER, 'Retry-After'],
      maxAge: 600,
    }),
  );

  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.use(
    createHealthRouter({
      version: APP_VERSION,
      checks,
      exposeCheckErrors: isDevelopment,
    }),
  );

  app.use(notFound);
  app.use(createErrorHandler({ exposeInternalErrors: isDevelopment }));

  return app;
}
