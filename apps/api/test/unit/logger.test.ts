import { describe, expect, it } from 'vitest';
import { createLogger } from '../../src/lib/logger';
import { captureLogs } from '../helpers/logs';

function setup(level: 'info' | 'warn' = 'info') {
  const logs = captureLogs();
  const logger = createLogger({ NODE_ENV: 'production', LOG_LEVEL: level }, logs.stream);
  return { logger, entries: logs.entries };
}

describe('createLogger', () => {
  it('agrega el servicio, el nivel y la hora en ISO', () => {
    const { logger, entries } = setup();
    logger.info('hola');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ service: 'rrpp-api', level: 30, msg: 'hola' });
    expect(new Date(String(entries[0]?.time)).toISOString()).toBe(entries[0]?.time);
  });

  it('respeta LOG_LEVEL', () => {
    const { logger, entries } = setup('warn');
    logger.info('no sale');
    logger.warn('sale');
    expect(entries.map((e) => e.msg)).toEqual(['sale']);
  });

  it('redacta los headers sensibles de req y res', () => {
    const { logger, entries } = setup();
    logger.info({
      req: {
        headers: {
          authorization: 'Bearer token-secreto',
          cookie: 'sb-access-token=abc',
          'x-api-key': 'clave',
          'user-agent': 'vitest',
        },
      },
      res: { headers: { 'set-cookie': 'session=abc' } },
    });
    expect(entries[0]).toMatchObject({
      req: {
        headers: {
          authorization: '[REDACTED]',
          cookie: '[REDACTED]',
          'x-api-key': '[REDACTED]',
          'user-agent': 'vitest',
        },
      },
      res: { headers: { 'set-cookie': '[REDACTED]' } },
    });
  });

  it.each(['token', 'apiKey', 'password', 'serviceRoleKey'])(
    'redacta %s en la raíz y anidado hasta dos niveles',
    (key) => {
      const { logger, entries } = setup();
      logger.info({ [key]: 's0', a: { [key]: 's1', b: { [key]: 's2' } }, keep: 'visible' });
      expect(entries[0]).toMatchObject({
        [key]: '[REDACTED]',
        a: { [key]: '[REDACTED]', b: { [key]: '[REDACTED]' } },
        keep: 'visible',
      });
      expect(JSON.stringify(entries[0])).not.toMatch(/"s[012]"/);
    },
  );

  it('redacta las variables secretas si se loguea la configuración', () => {
    const { logger, entries } = setup();
    logger.info({
      env: {
        SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x',
        SUPABASE_JWT_SECRET: 'jwt',
        ANTHROPIC_API_KEY: 'sk-ant-x',
        PORT: 4000,
      },
    });
    expect(entries[0]).toMatchObject({
      env: {
        SUPABASE_SERVICE_ROLE_KEY: '[REDACTED]',
        SUPABASE_JWT_SECRET: '[REDACTED]',
        ANTHROPIC_API_KEY: '[REDACTED]',
        PORT: 4000,
      },
    });
  });
});
