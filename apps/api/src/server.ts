import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { APP_VERSION, createApp } from './app';
import { EnvValidationError, loadDotenvFile, loadEnv, type Env } from './config/env';
import { createLogger } from './lib/logger';
import { createServiceClient, pingDatabase } from './lib/supabase';

// apps/api/.env, tanto desde src/ (tsx) como desde dist/ (build)
const ENV_FILE_PATH = fileURLToPath(new URL('../.env', import.meta.url));

// Mayor que el idle timeout típico de los balanceadores (60 s) para evitar 502 por conexiones cortadas
const KEEP_ALIVE_TIMEOUT_MS = 65_000;
const IDLE_SWEEP_INTERVAL_MS = 250;

function readEnvOrExit(): Env {
  try {
    loadDotenvFile(ENV_FILE_PATH);
    return loadEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      process.stderr.write(
        `${error.message}\n\nRevisá apps/api/.env (podés partir de apps/api/.env.example).\n`,
      );
      process.exit(1);
    }
    throw error;
  }
}

function main(): void {
  const env = readEnvOrExit();
  const logger = createLogger(env);

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled promise rejection');
    process.exit(1);
  });

  const supabase = createServiceClient(env);
  const app = createApp({
    env,
    logger,
    checks: { database: () => pingDatabase(supabase) },
  });

  const server = createServer(app);
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = KEEP_ALIVE_TIMEOUT_MS + 1000;

  server.on('error', (error) => {
    logger.fatal({ err: error }, 'HTTP server error');
    process.exit(1);
  });

  server.listen(env.PORT, env.HOST, () => {
    logger.info(
      { host: env.HOST, port: env.PORT, nodeEnv: env.NODE_ENV, version: APP_VERSION },
      'API listening',
    );
  });

  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      logger.warn({ signal }, 'second signal received, forcing exit');
      process.exit(1);
    }
    shuttingDown = true;
    logger.info(
      { signal, timeoutMs: env.SHUTDOWN_TIMEOUT_MS },
      'shutting down: refusing new connections and waiting for in-flight requests',
    );

    const forceExit = setTimeout(() => {
      logger.error({ timeoutMs: env.SHUTDOWN_TIMEOUT_MS }, 'shutdown timed out, forcing exit');
      server.closeAllConnections();
      process.exit(1);
    }, env.SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    // Las conexiones keep-alive se cierran apenas terminan su request en curso
    const idleSweep = setInterval(() => {
      server.closeIdleConnections();
    }, IDLE_SWEEP_INTERVAL_MS);
    idleSweep.unref();

    server.close((error) => {
      clearInterval(idleSweep);
      clearTimeout(forceExit);
      if (error !== undefined) {
        logger.error({ err: error }, 'error while closing HTTP server');
        process.exit(1);
      }
      logger.info('HTTP server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();
