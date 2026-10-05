import express, { type RequestHandler } from 'express';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError, ERROR_CATALOG, ErrorCode } from '../../src/lib/errors';
import { createLogger } from '../../src/lib/logger';
import { createErrorHandler, toAppError } from '../../src/middleware/errorHandler';
import { genReqId } from '../../src/middleware/requestId';
import { captureLogs } from '../helpers/logs';

const SECRET_INTERNAL_MESSAGE = 'db exploded: password=hunter2 at /srv/secret/path.ts';

function buildApp(handler: RequestHandler, exposeInternalErrors = false) {
  const logs = captureLogs();
  const logger = createLogger({ NODE_ENV: 'test', LOG_LEVEL: 'trace' }, logs.stream);
  const app = express();
  app.use(pinoHttp({ logger, genReqId, autoLogging: false }));
  app.use(express.json({ limit: '1kb' }));
  app.all('/boom', handler);
  app.use(createErrorHandler({ exposeInternalErrors }));
  return { app, logs };
}

function httpError(status: number, props: Record<string, unknown> = {}): Error {
  return Object.assign(new Error('http error'), { status, ...props });
}

describe('errorHandler', () => {
  it('devuelve un AppError expuesto con su código, mensaje y detalles', async () => {
    const { app } = buildApp(() => {
      throw new AppError(ErrorCode.CONFLICT, {
        message: 'Ya existe un evento con ese nombre.',
        details: { field: 'name' },
      });
    });

    const res = await request(app).get('/boom').expect(409);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({
      error: {
        code: 'CONFLICT',
        message: 'Ya existe un evento con ese nombre.',
        details: { field: 'name' },
        requestId: res.headers['x-request-id'],
      },
    });
  });

  it('omite details cuando no hay', async () => {
    const { app } = buildApp(() => {
      throw new AppError(ErrorCode.EVENT_NOT_FOUND);
    });
    const res = await request(app).get('/boom').expect(404);
    expect(res.body.error).not.toHaveProperty('details');
    expect(res.body.error.message).toBe(ERROR_CATALOG.EVENT_NOT_FOUND.message);
  });

  it('usa el mensaje del catálogo para un AppError no expuesto', async () => {
    const { app } = buildApp(() => {
      throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
        message: SECRET_INTERNAL_MESSAGE,
        details: { host: 'db.internal' },
      });
    });
    const res = await request(app).get('/boom').expect(503);
    expect(res.body.error).toEqual({
      code: 'SERVICE_UNAVAILABLE',
      message: ERROR_CATALOG.SERVICE_UNAVAILABLE.message,
      requestId: res.headers['x-request-id'],
    });
  });

  it('convierte un ZodError en 422 VALIDATION_ERROR con los errores aplanados', async () => {
    const { app } = buildApp((req) => {
      z.object({ name: z.string(), age: z.number() }).parse(req.body);
    });
    const res = await request(app).post('/boom').send({ age: 'veinte' }).expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toBe(ERROR_CATALOG.VALIDATION_ERROR.message);
    expect(res.body.error.details).toEqual({
      formErrors: [],
      fieldErrors: { name: [expect.any(String)], age: [expect.any(String)] },
    });
  });

  it('atrapa promesas rechazadas y devuelve 500 genérico sin filtrar nada', async () => {
    const { app } = buildApp(async () => {
      await Promise.resolve();
      throw new Error(SECRET_INTERNAL_MESSAGE);
    });
    const res = await request(app).get('/boom').expect(500);
    expect(res.body).toEqual({
      error: {
        code: 'INTERNAL',
        message: ERROR_CATALOG.INTERNAL.message,
        requestId: res.headers['x-request-id'],
      },
    });
    expect(res.text).not.toContain('hunter2');
    expect(res.text).not.toContain('secret');
    expect(res.text).not.toContain('.ts');
  });

  it('maneja valores que no son Error', async () => {
    const { app } = buildApp((_req, _res, next) => {
      next({ weird: true });
    });
    const res = await request(app).get('/boom').expect(500);
    expect(res.body.error.code).toBe('INTERNAL');
  });

  it('en desarrollo agrega el detalle del error interno', async () => {
    const { app } = buildApp(() => {
      throw new Error(SECRET_INTERNAL_MESSAGE);
    }, true);
    const res = await request(app).get('/boom').expect(500);
    expect(res.body.error.message).toBe(ERROR_CATALOG.INTERNAL.message);
    expect(res.body.error.details.debug).toMatchObject({
      name: 'Error',
      message: SECRET_INTERNAL_MESSAGE,
      stack: expect.arrayContaining([expect.stringContaining('Error')]),
    });
  });

  it.each([
    [400, 'BAD_REQUEST'],
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [415, 'UNSUPPORTED_MEDIA_TYPE'],
    [418, 'BAD_REQUEST'],
    [429, 'RATE_LIMITED'],
    [502, 'INTERNAL'],
    [503, 'SERVICE_UNAVAILABLE'],
  ] as const)('traduce errores HTTP con status %i a %s', async (status, code) => {
    const { app } = buildApp((_req, _res, next) => {
      next(httpError(status));
    });
    const res = await request(app).get('/boom');
    expect(res.status).toBe(ERROR_CATALOG[code].status);
    expect(res.body.error.code).toBe(code);
  });

  it('lee statusCode además de status', async () => {
    const { app } = buildApp((_req, _res, next) => {
      next(Object.assign(new Error('x'), { statusCode: 403 }));
    });
    await request(app).get('/boom').expect(403);
  });

  it('ignora un status que no es de error', async () => {
    const { app } = buildApp((_req, _res, next) => {
      next(httpError(200));
    });
    const res = await request(app).get('/boom').expect(500);
    expect(res.body.error.code).toBe('INTERNAL');
  });

  it('JSON inválido → 400 INVALID_JSON', async () => {
    const { app } = buildApp((_req, res) => {
      res.json({ ok: true });
    });
    const res = await request(app)
      .post('/boom')
      .set('Content-Type', 'application/json')
      .send('{"name": ')
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
    expect(res.body.error.message).toBe(ERROR_CATALOG.INVALID_JSON.message);
  });

  it('cuerpo demasiado grande → 413 con el límite', async () => {
    const { app } = buildApp((_req, res) => {
      res.json({ ok: true });
    });
    const res = await request(app)
      .post('/boom')
      .send({ data: 'x'.repeat(2048) })
      .expect(413);
    expect(res.body.error).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      details: { limitBytes: 1024 },
    });
  });

  it('charset no soportado → 415', async () => {
    const { app } = buildApp((_req, res) => {
      res.json({ ok: true });
    });
    const res = await request(app)
      .post('/boom')
      .set('Content-Type', 'application/json; charset=klingon')
      .send('{}')
      .expect(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  describe('logs', () => {
    it('loguea los 5xx en nivel error con el error original', async () => {
      const { app, logs } = buildApp(() => {
        throw new Error(SECRET_INTERNAL_MESSAGE);
      });
      await request(app).get('/boom').expect(500);
      const entry = logs.entries.find((e) => e.msg === 'request failed');
      expect(entry).toMatchObject({
        level: 50,
        code: 'INTERNAL',
        status: 500,
        err: { message: SECRET_INTERNAL_MESSAGE },
      });
    });

    it.each([
      [404, 30],
      [409, 30],
      [401, 40],
      [403, 40],
      [429, 40],
    ])('loguea un %i en nivel %i, sin stack', async (status, level) => {
      const { app, logs } = buildApp((_req, _res, next) => {
        next(httpError(status));
      });
      await request(app).get('/boom').expect(status);
      const entry = logs.entries.find((e) => e.msg === 'request rejected');
      expect(entry).toMatchObject({ level, status });
      expect(entry).not.toHaveProperty('err');
    });
  });
});

describe('toAppError', () => {
  it('devuelve el mismo AppError', () => {
    const error = new AppError(ErrorCode.FORBIDDEN);
    expect(toAppError(error)).toBe(error);
  });

  it('envuelve un error desconocido como INTERNAL conservando la causa', () => {
    const original = new TypeError('x is undefined');
    const error = toAppError(original);
    expect(error.code).toBe('INTERNAL');
    expect(error.cause).toBe(original);
    expect(error.expose).toBe(false);
  });
});
