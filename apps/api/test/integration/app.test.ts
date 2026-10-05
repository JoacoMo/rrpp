import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import packageJson from '../../package.json' with { type: 'json' };
import { createApp } from '../../src/app';
import type { Env } from '../../src/config/env';
import { ERROR_CATALOG } from '../../src/lib/errors';
import { createLogger } from '../../src/lib/logger';
import type { PingResult } from '../../src/lib/supabase';
import { buildEnv } from '../helpers/env';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ALLOWED_ORIGIN = 'http://localhost:5173';
const ONE_MEGABYTE = 1024 * 1024;

interface BuildOptions {
  env?: Env;
  database?: () => Promise<PingResult>;
}

function buildApp({
  env = buildEnv(),
  database = () => Promise.resolve({ ok: true, latencyMs: 3 }),
}: BuildOptions = {}) {
  const logger = createLogger({ NODE_ENV: 'test', LOG_LEVEL: 'silent' });
  return createApp({ env, logger, checks: { database } });
}

/** Body JSON de aproximadamente `bytes` bytes. */
function jsonOfSize(bytes: number): string {
  const wrapper = '{"data":""}';
  return `{"data":"${'x'.repeat(bytes - wrapper.length)}"}`;
}

describe('GET /healthz', () => {
  it('responde ok con uptime y versión', async () => {
    const res = await request(buildApp()).get('/healthz').expect(200);
    expect(res.body).toEqual({
      status: 'ok',
      uptimeSeconds: expect.any(Number),
      version: packageJson.version,
    });
    expect(res.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('no consulta la base', async () => {
    let calls = 0;
    const app = buildApp({
      database: () => {
        calls += 1;
        return Promise.resolve({ ok: true, latencyMs: 1 });
      },
    });
    await request(app).get('/healthz').expect(200);
    expect(calls).toBe(0);
  });

  it('manda headers de seguridad y oculta x-powered-by', async () => {
    const res = await request(buildApp()).get('/healthz').expect(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
  });
});

describe('GET /readyz', () => {
  it('200 ready cuando la base responde', async () => {
    const res = await request(buildApp()).get('/readyz').expect(200);
    expect(res.body).toEqual({ status: 'ready', checks: { database: { ok: true, latencyMs: 3 } } });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('503 unavailable cuando la base falla, sin exponer el motivo fuera de desarrollo', async () => {
    const app = buildApp({
      database: () =>
        Promise.resolve({ ok: false, latencyMs: 12, error: 'PGRST000: connection refused' }),
    });
    const res = await request(app).get('/readyz').expect(503);
    expect(res.body).toEqual({
      status: 'unavailable',
      checks: { database: { ok: false, latencyMs: 12 } },
    });
  });

  it('en desarrollo incluye el motivo de la falla', async () => {
    const app = buildApp({
      env: buildEnv({ NODE_ENV: 'development' }),
      database: () => Promise.resolve({ ok: false, latencyMs: 5, error: 'timeout after 3000ms' }),
    });
    const res = await request(app).get('/readyz').expect(503);
    expect(res.body.checks.database).toEqual({
      ok: false,
      latencyMs: 5,
      error: 'timeout after 3000ms',
    });
  });

  it('503 si el chequeo lanza en lugar de devolver', async () => {
    const app = buildApp({ database: () => Promise.reject(new Error('explotó')) });
    const res = await request(app).get('/readyz').expect(503);
    expect(res.body).toEqual({
      status: 'unavailable',
      checks: { database: { ok: false, latencyMs: expect.any(Number) } },
    });
  });
});

describe('errores', () => {
  it('404 con la forma de error única', async () => {
    const res = await request(buildApp()).get('/no-existe').expect(404);
    expect(res.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'La ruta solicitada no existe.',
        details: { method: 'GET', path: '/no-existe' },
        requestId: res.headers['x-request-id'],
      },
    });
  });

  it('todavía no hay rutas /v1', async () => {
    const res = await request(buildApp()).get('/v1/me').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('JSON inválido → 400 INVALID_JSON', async () => {
    const res = await request(buildApp())
      .post('/v1/jobs')
      .set('Content-Type', 'application/json')
      .send('{"usernames": [')
      .expect(400);
    expect(res.body).toEqual({
      error: {
        code: 'INVALID_JSON',
        message: ERROR_CATALOG.INVALID_JSON.message,
        requestId: res.headers['x-request-id'],
      },
    });
  });

  it('body de más de 1 MB → 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await request(buildApp())
      .post('/v1/jobs')
      .set('Content-Type', 'application/json')
      .send(jsonOfSize(ONE_MEGABYTE + 1024))
      .expect(413);
    expect(res.body.error).toEqual({
      code: 'PAYLOAD_TOO_LARGE',
      message: ERROR_CATALOG.PAYLOAD_TOO_LARGE.message,
      details: { limitBytes: ONE_MEGABYTE },
      requestId: res.headers['x-request-id'],
    });
  });

  it('un body justo por debajo de 1 MB pasa el parser', async () => {
    const res = await request(buildApp())
      .post('/v1/jobs')
      .set('Content-Type', 'application/json')
      .send(jsonOfSize(ONE_MEGABYTE - 1024))
      .expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('x-request-id', () => {
  it('genera un UUID si no viene', async () => {
    const first = await request(buildApp()).get('/healthz');
    const second = await request(buildApp()).get('/healthz');
    expect(first.headers['x-request-id']).toMatch(UUID_REGEX);
    expect(second.headers['x-request-id']).toMatch(UUID_REGEX);
    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
  });

  it('reutiliza un id válido y lo usa en el error', async () => {
    const id = 'proxy-Req_123.abc';
    const res = await request(buildApp()).get('/no-existe').set('X-Request-Id', id).expect(404);
    expect(res.headers['x-request-id']).toBe(id);
    expect(res.body.error.requestId).toBe(id);
  });

  it.each([
    ['con espacios', 'tiene espacios'],
    ['demasiado largo', 'a'.repeat(65)],
    ['con caracteres peligrosos', '<script>alert(1)</script>'],
    ['con salto de línea codificado', 'id%0Afalso'],
  ])('descarta un id %s y genera uno nuevo', async (_case, id) => {
    const res = await request(buildApp()).get('/healthz').set('X-Request-Id', id).expect(200);
    expect(res.headers['x-request-id']).toMatch(UUID_REGEX);
  });
});

describe('CORS', () => {
  it('permite un origen de la lista blanca', async () => {
    const res = await request(buildApp()).get('/healthz').set('Origin', ALLOWED_ORIGIN).expect(200);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(res.headers.vary).toMatch(/Origin/);
    expect(res.headers['access-control-expose-headers']).toMatch(/x-request-id/i);
  });

  it('responde el preflight de un origen permitido', async () => {
    const res = await request(buildApp())
      .options('/v1/jobs')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type')
      .expect(204);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(res.headers['access-control-allow-methods']).toMatch(/POST/);
    expect(res.headers['access-control-allow-headers']).toMatch(/Authorization/);
    expect(res.headers['access-control-max-age']).toBe('600');
  });

  it('no agrega headers CORS para un origen no permitido, sin fallar', async () => {
    const res = await request(buildApp())
      .get('/healthz')
      .set('Origin', 'https://evil.example')
      .expect(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('el preflight de un origen no permitido no da 500 ni headers CORS', async () => {
    const res = await request(buildApp())
      .options('/v1/jobs')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBeLessThan(500);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('las requests sin Origin (scraper, curl) funcionan sin headers CORS', async () => {
    const res = await request(buildApp()).get('/healthz').expect(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('configuración', () => {
  it('trust proxy sigue a TRUST_PROXY', () => {
    expect(buildApp().get('trust proxy')).toBe(false);
    expect(buildApp({ env: buildEnv({ TRUST_PROXY: '1' }) }).get('trust proxy')).toBe(1);
  });

  it('deja los mensajes de zod en español', () => {
    buildApp();
    const result = z.string().safeParse(42);
    expect(result.error?.issues[0]?.message).toMatch(/^Entrada inválida/);
  });
});
