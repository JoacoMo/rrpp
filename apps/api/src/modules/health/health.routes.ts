import { Router } from 'express';

export interface CheckResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export type ReadinessCheck = () => Promise<CheckResult>;

export interface HealthRouterOptions {
  version: string;
  /** Dependencias que tienen que responder para que la API reciba tráfico. */
  checks: Readonly<Record<string, ReadinessCheck>>;
  /** Incluir el motivo de cada falla en la respuesta (fuera de producción). */
  exposeCheckErrors: boolean;
}

async function runCheck(check: ReadinessCheck): Promise<CheckResult> {
  const startedAt = performance.now();
  try {
    return await check();
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : 'check failed',
    };
  }
}

export function createHealthRouter({
  version,
  checks,
  exposeCheckErrors,
}: HealthRouterOptions): Router {
  const router = Router();

  // Liveness: el proceso está vivo y atiende HTTP. No toca dependencias.
  router.get('/healthz', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({
      status: 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
      version,
    });
  });

  // Readiness: las dependencias responden; si no, 503 para que el balanceador no mande tráfico
  router.get('/readyz', async (req, res) => {
    const results = await Promise.all(
      Object.entries(checks).map(async ([name, check]) => [name, await runCheck(check)] as const),
    );

    const ready = results.every(([, result]) => result.ok);
    const publicChecks: Record<string, CheckResult> = {};
    for (const [name, result] of results) {
      if (!result.ok) req.log.warn({ check: name, error: result.error }, 'readiness check failed');
      publicChecks[name] = exposeCheckErrors
        ? result
        : { ok: result.ok, latencyMs: result.latencyMs };
    }

    res
      .status(ready ? 200 : 503)
      .set('Cache-Control', 'no-store')
      .json({ status: ready ? 'ready' : 'unavailable', checks: publicChecks });
  });

  return router;
}
