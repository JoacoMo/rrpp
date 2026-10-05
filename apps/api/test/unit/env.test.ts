import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  CLAUDE_EFFORTS,
  ENV_VARS,
  EnvValidationError,
  getEnv,
  loadDotenvFile,
  loadEnv,
} from '../../src/config/env';
import { REQUIRED_ENV_SOURCE, TEST_ENV_SOURCE, TEST_SECRETS, fakeJwt } from '../helpers/env';

function captureEnvError(source: Record<string, string | undefined>): EnvValidationError {
  try {
    loadEnv(source);
  } catch (error) {
    if (error instanceof EnvValidationError) return error;
    throw error;
  }
  throw new Error('loadEnv no lanzó EnvValidationError');
}

describe('loadEnv', () => {
  it('aplica los valores por defecto', () => {
    expect(loadEnv(REQUIRED_ENV_SOURCE)).toEqual({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 4000,
      LOG_LEVEL: 'info',
      TRUST_PROXY: 0,
      CORS_ORIGINS: ['http://localhost:5173', 'https://app.rrpp.test'],
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: TEST_SECRETS.serviceRoleKey,
      SUPABASE_JWT_SECRET: undefined,
      ANTHROPIC_API_KEY: TEST_SECRETS.anthropicApiKey,
      CLAUDE_MODEL: 'claude-opus-5-5',
      CLAUDE_EFFORT: 'medium',
      STORAGE_MEDIA_BUCKET: 'profile-media',
      SHUTDOWN_TIMEOUT_MS: 10_000,
    });
  });

  it('lee y convierte todas las variables', () => {
    const jwtSecret = 'a-legacy-jwt-secret-with-at-least-32-chars';
    const env = loadEnv({
      ...REQUIRED_ENV_SOURCE,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: '8080',
      LOG_LEVEL: 'warn',
      TRUST_PROXY: '2',
      SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co/',
      SUPABASE_JWT_SECRET: jwtSecret,
      CLAUDE_MODEL: 'claude-sonnet-5-5',
      CLAUDE_EFFORT: 'xhigh',
      STORAGE_MEDIA_BUCKET: 'media_bucket-2',
      SHUTDOWN_TIMEOUT_MS: '25000',
    });

    expect(env).toMatchObject({
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: 8080,
      LOG_LEVEL: 'warn',
      TRUST_PROXY: 2,
      SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co',
      SUPABASE_JWT_SECRET: jwtSecret,
      CLAUDE_MODEL: 'claude-sonnet-5-5',
      CLAUDE_EFFORT: 'xhigh',
      STORAGE_MEDIA_BUCKET: 'media_bucket-2',
      SHUTDOWN_TIMEOUT_MS: 25_000,
    });
  });

  it('devuelve una configuración congelada', () => {
    const env = loadEnv(REQUIRED_ENV_SOURCE);
    expect(Object.isFrozen(env)).toBe(true);
    expect(Object.isFrozen(env.CORS_ORIGINS)).toBe(true);
  });

  it('ignora las variables que no conoce', () => {
    const env = loadEnv({ ...REQUIRED_ENV_SOURCE, DATABASE_PASSWORD: 'no-me-leas' });
    expect(env).not.toHaveProperty('DATABASE_PASSWORD');
  });

  it('trata los valores vacíos o con solo espacios como no definidos', () => {
    const env = loadEnv({
      ...REQUIRED_ENV_SOURCE,
      PORT: '',
      LOG_LEVEL: '   ',
      SUPABASE_JWT_SECRET: '',
    });
    expect(env.PORT).toBe(4000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.SUPABASE_JWT_SECRET).toBeUndefined();

    const error = captureEnvError({ ...REQUIRED_ENV_SOURCE, ANTHROPIC_API_KEY: '  ' });
    expect(error.issues).toEqual([{ variable: 'ANTHROPIC_API_KEY', message: 'falta definirla' }]);
  });

  it('recorta los espacios alrededor de los valores', () => {
    const env = loadEnv({ ...REQUIRED_ENV_SOURCE, PORT: ' 8080 ', NODE_ENV: ' test ' });
    expect(env.PORT).toBe(8080);
    expect(env.NODE_ENV).toBe('test');
  });

  it('reporta juntas todas las variables obligatorias que faltan', () => {
    const error = captureEnvError({});
    expect(error).toBeInstanceOf(EnvValidationError);
    expect(error.name).toBe('EnvValidationError');
    expect(error.variables).toEqual([
      'CORS_ORIGINS',
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'ANTHROPIC_API_KEY',
    ]);
    for (const issue of error.issues) {
      expect(issue.message).toBe('falta definirla');
      expect(error.message).toContain(`${issue.variable}: falta definirla`);
    }
  });

  it.each([
    ['NODE_ENV', 'staging'],
    ['HOST', 'local host'],
    ['PORT', 'abc'],
    ['PORT', '0'],
    ['PORT', '65536'],
    ['PORT', '80.5'],
    ['PORT', '-1'],
    ['PORT', '1e3'],
    ['LOG_LEVEL', 'verbose'],
    ['TRUST_PROXY', 'true'],
    ['TRUST_PROXY', '-1'],
    ['TRUST_PROXY', '33'],
    ['CORS_ORIGINS', 'https://app.rrpp.test/'],
    ['SUPABASE_URL', 'no-es-una-url'],
    ['SUPABASE_URL', 'ftp://abcdefghijklmnop.supabase.co'],
    ['SUPABASE_URL', 'abcdefghijklmnop.supabase.co'],
    ['SUPABASE_SERVICE_ROLE_KEY', 'no-es-una-key'],
    ['SUPABASE_SERVICE_ROLE_KEY', 'sb_secret_corta'],
    ['SUPABASE_SERVICE_ROLE_KEY', 'sb_publishable_AbCdEf0123456789xyz'],
    ['SUPABASE_SERVICE_ROLE_KEY', fakeJwt({ iss: 'supabase', role: 'anon' })],
    ['SUPABASE_SERVICE_ROLE_KEY', fakeJwt({ iss: 'supabase' })],
    ['SUPABASE_SERVICE_ROLE_KEY', 'eyJhbGciOiJIUzI1NiJ9.no-es-json.firma'],
    ['SUPABASE_JWT_SECRET', 'demasiado-corto'],
    ['ANTHROPIC_API_KEY', 'sk-abc123'],
    ['ANTHROPIC_API_KEY', 'no-es-una-key'],
    ['CLAUDE_MODEL', 'gpt-4o'],
    ['CLAUDE_MODEL', 'claude opus'],
    ['CLAUDE_EFFORT', 'extreme'],
    ['CLAUDE_EFFORT', 'MEDIUM'],
    ['STORAGE_MEDIA_BUCKET', 'Profile Media'],
    ['STORAGE_MEDIA_BUCKET', '-bucket'],
    ['SHUTDOWN_TIMEOUT_MS', '10'],
    ['SHUTDOWN_TIMEOUT_MS', '999999'],
  ])('reporta %s inválida (%s)', (variable, value) => {
    const error = captureEnvError({ ...REQUIRED_ENV_SOURCE, [variable]: value });
    expect(error.variables).toEqual([variable]);
    expect(error.message).toContain(`  - ${variable}: `);
  });

  it('reporta todas las variables inválidas a la vez', () => {
    const error = captureEnvError({
      ...REQUIRED_ENV_SOURCE,
      PORT: 'abc',
      CLAUDE_EFFORT: 'extreme',
      SUPABASE_URL: 'nope',
    });
    expect(error.variables).toEqual(['PORT', 'SUPABASE_URL', 'CLAUDE_EFFORT']);
  });

  it('acepta secret keys nuevas y service_role keys JWT legacy', () => {
    const legacy = fakeJwt({ iss: 'supabase', ref: 'abcdefghijklmnop', role: 'service_role' });
    expect(loadEnv({ ...REQUIRED_ENV_SOURCE, SUPABASE_SERVICE_ROLE_KEY: legacy })).toMatchObject({
      SUPABASE_SERVICE_ROLE_KEY: legacy,
    });
    // Armada por partes para que el escaneo de secretos de GitHub no la confunda con una real
    const modern = ['sb', 'secret', 'SoloParaTests-0123456789abcdef'].join('_');
    expect(loadEnv({ ...REQUIRED_ENV_SOURCE, SUPABASE_SERVICE_ROLE_KEY: modern })).toMatchObject({
      SUPABASE_SERVICE_ROLE_KEY: modern,
    });
  });

  it.each(CLAUDE_EFFORTS)('acepta CLAUDE_EFFORT=%s', (effort) => {
    expect(loadEnv({ ...REQUIRED_ENV_SOURCE, CLAUDE_EFFORT: effort }).CLAUDE_EFFORT).toBe(effort);
  });
});

describe('secretos en los errores', () => {
  it('nunca incluye el valor de un secreto inválido', () => {
    const secrets = {
      SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_MARCA!SECRETA#uno-0123456789',
      ANTHROPIC_API_KEY: 'MARCA-SECRETA-dos-0123456789',
      SUPABASE_JWT_SECRET: 'MARCA-SECRETA-tres',
    };
    const error = captureEnvError({ ...REQUIRED_ENV_SOURCE, ...secrets });

    expect(error.variables).toEqual([
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_JWT_SECRET',
      'ANTHROPIC_API_KEY',
    ]);
    const serialized = [error.message, JSON.stringify(error.issues), String(error.stack)].join(
      '\n',
    );
    for (const secret of Object.values(secrets)) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toContain('MARCA');
  });

  it('no muestra la anon key cuando se usa en lugar de la service role', () => {
    const anonKey = fakeJwt({ iss: 'supabase', role: 'anon' });
    const error = captureEnvError({ ...REQUIRED_ENV_SOURCE, SUPABASE_SERVICE_ROLE_KEY: anonKey });
    expect(error.message).not.toContain(anonKey);
    expect(error.message).toContain('anon key');
  });

  it('no incluye secretos válidos cuando falla otra variable', () => {
    const error = captureEnvError({ ...TEST_ENV_SOURCE, PORT: 'abc' });
    expect(error.message).not.toContain(TEST_SECRETS.serviceRoleKey);
    expect(error.message).not.toContain(TEST_SECRETS.anthropicApiKey);
  });
});

describe('CORS_ORIGINS', () => {
  const parse = (value: string): readonly string[] =>
    loadEnv({ ...REQUIRED_ENV_SOURCE, CORS_ORIGINS: value }).CORS_ORIGINS;

  it('acepta un solo origen', () => {
    expect(parse('https://app.rrpp.test')).toEqual(['https://app.rrpp.test']);
  });

  it('separa por comas, recorta espacios, normaliza y deduplica', () => {
    expect(
      parse(' http://localhost:5173 , https://APP.rrpp.test:443,http://localhost:5173,, '),
    ).toEqual(['http://localhost:5173', 'https://app.rrpp.test']);
  });

  it('conserva puertos no estándar', () => {
    expect(parse('http://127.0.0.1:8080')).toEqual(['http://127.0.0.1:8080']);
  });

  it.each([
    ['barra final', 'https://app.rrpp.test/'],
    ['ruta', 'https://app.rrpp.test/app'],
    ['query', 'https://app.rrpp.test?x=1'],
    ['hash', 'https://app.rrpp.test#x'],
    ['comodín', '*'],
    ['sin protocolo', 'app.rrpp.test'],
    ['protocolo no http', 'ftp://app.rrpp.test'],
    ['extensión de Chrome', 'chrome-extension://abcdefghijklmnop'],
    ['credenciales', 'https://user:pass@app.rrpp.test'],
  ])('rechaza un origen con %s', (_case, value) => {
    const error = captureEnvError({ ...REQUIRED_ENV_SOURCE, CORS_ORIGINS: value });
    expect(error.variables).toEqual(['CORS_ORIGINS']);
    expect(error.message).toContain(`"${value}" no es un origen válido`);
  });

  it('rechaza una lista sin orígenes', () => {
    const error = captureEnvError({ ...REQUIRED_ENV_SOURCE, CORS_ORIGINS: ' , ,' });
    expect(error.issues).toEqual([
      { variable: 'CORS_ORIGINS', message: 'tiene que tener al menos un origen' },
    ]);
  });

  it('informa cada origen inválido de una lista', () => {
    const error = captureEnvError({
      ...REQUIRED_ENV_SOURCE,
      CORS_ORIGINS: 'https://ok.rrpp.test,https://malo.rrpp.test/,*',
    });
    expect(error.variables).toEqual(['CORS_ORIGINS']);
    expect(error.message).toContain('"https://malo.rrpp.test/"');
    expect(error.message).toContain('"*"');
    expect(error.message).not.toContain('"https://ok.rrpp.test"');
  });
});

describe('getEnv', () => {
  it('valida process.env una sola vez y reutiliza el resultado', () => {
    for (const name of ENV_VARS) vi.stubEnv(name, undefined);
    for (const [name, value] of Object.entries(TEST_ENV_SOURCE)) vi.stubEnv(name, value);
    vi.stubEnv('PORT', '4321');

    const first = getEnv();
    expect(first.PORT).toBe(4321);

    vi.stubEnv('PORT', '9999');
    expect(getEnv()).toBe(first);
    expect(getEnv().PORT).toBe(4321);
  });
});

describe('loadDotenvFile', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rrpp-env-'));

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('ignora en silencio un archivo que no existe', () => {
    expect(loadDotenvFile(join(dir, 'no-existe.env'))).toBe(false);
  });

  it('carga las variables del archivo sin pisar las del entorno', () => {
    vi.stubEnv('RRPP_TEST_FROM_FILE', undefined);
    vi.stubEnv('RRPP_TEST_ALREADY_SET', 'del-entorno');
    const file = join(dir, 'valido.env');
    writeFileSync(file, 'RRPP_TEST_FROM_FILE=desde-archivo\nRRPP_TEST_ALREADY_SET=desde-archivo\n');

    expect(loadDotenvFile(file)).toBe(true);
    expect(process.env.RRPP_TEST_FROM_FILE).toBe('desde-archivo');
    expect(process.env.RRPP_TEST_ALREADY_SET).toBe('del-entorno');
  });

  it('relanza los errores que no son "archivo inexistente"', () => {
    expect(() => loadDotenvFile(dir)).toThrow();
  });
});
