import { Buffer } from 'node:buffer';
import { loadEnv, type Env } from '../../src/config/env';

/** Arma un JWT con firma falsa: alcanza para los chequeos de formato y de rol. */
export function fakeJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.ZmFrZS1zaWduYXR1cmU`;
}

export const TEST_SECRETS = {
  serviceRoleKey: 'sb_secret_TestOnlyKey_0123456789abcdef',
  anthropicApiKey: 'sk-ant-api03-test-only-key-0123456789',
} as const;

/** Mínimo de variables para que loadEnv valide. */
export const REQUIRED_ENV_SOURCE: Readonly<Record<string, string>> = {
  CORS_ORIGINS: 'http://localhost:5173,https://app.rrpp.test',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: TEST_SECRETS.serviceRoleKey,
  ANTHROPIC_API_KEY: TEST_SECRETS.anthropicApiKey,
};

export const TEST_ENV_SOURCE: Readonly<Record<string, string>> = {
  ...REQUIRED_ENV_SOURCE,
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
};

export function buildEnv(overrides: Record<string, string | undefined> = {}): Env {
  return loadEnv({ ...TEST_ENV_SOURCE, ...overrides });
}
