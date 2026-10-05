import { Buffer } from 'node:buffer';
import { z } from 'zod';

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

/** Variables cuyo valor nunca se muestra en errores ni en logs. */
export const SECRET_ENV_VARS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_JWT_SECRET',
  'ANTHROPIC_API_KEY',
] as const;

const MISSING = 'falta definirla';

// Los mensajes nunca incluyen el valor recibido: así no se filtran secretos
function text() {
  return z.string({
    error: (issue) => (issue.input === undefined ? MISSING : 'tiene que ser texto'),
  });
}

function oneOf<const T extends readonly [string, ...string[]]>(values: T) {
  return z.enum(values, {
    error: (issue) =>
      issue.input === undefined ? MISSING : `tiene que ser uno de: ${values.join(', ')}`,
  });
}

function integer(min: number, max: number, fallback: number) {
  const message = `tiene que ser un número entero entre ${min} y ${max}`;
  return text()
    .regex(/^\d+$/, message)
    .transform(Number)
    .pipe(z.number().int().min(min, message).max(max, message))
    .default(fallback);
}

function isHttpUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const { protocol } = new URL(value);
  return protocol === 'http:' || protocol === 'https:';
}

/** Devuelve el origen normalizado (ej. "https://app.ejemplo.com") o null si no es un origen exacto. */
function parseOrigin(value: string): string | null {
  if (value.endsWith('/') || !isHttpUrl(value)) return null;
  const url = new URL(value);
  const hasExtras =
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '';
  return hasExtras ? null : url.origin;
}

/** Rol del payload de un JWT, null si es un JWT sin rol, undefined si no es un JWT. */
function readJwtRole(token: string): string | null | undefined {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
    return undefined;
  }
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8'));
    if (typeof payload !== 'object' || payload === null) return undefined;
    return 'role' in payload && typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return undefined;
  }
}

const corsOriginsSchema = text().transform((value, ctx) => {
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  if (entries.length === 0) {
    ctx.addIssue({ code: 'custom', message: 'tiene que tener al menos un origen' });
    return z.NEVER;
  }

  const origins: string[] = [];
  for (const entry of entries) {
    const origin = parseOrigin(entry);
    if (origin === null) {
      ctx.addIssue({
        code: 'custom',
        message: `"${entry}" no es un origen válido (ej.: https://app.ejemplo.com, sin barra final ni ruta)`,
      });
    } else if (!origins.includes(origin)) {
      origins.push(origin);
    }
  }
  return origins;
});

const serviceRoleKeySchema = text().superRefine((value, ctx) => {
  if (value.startsWith('sb_secret_')) {
    if (!/^sb_secret_[A-Za-z0-9_-]{16,}$/.test(value)) {
      ctx.addIssue({
        code: 'custom',
        message: 'la secret key (sb_secret_...) tiene un formato inválido',
      });
    }
    return;
  }
  if (value.startsWith('sb_publishable_')) {
    ctx.addIssue({
      code: 'custom',
      message: 'es una publishable key; hace falta la secret key (sb_secret_...)',
    });
    return;
  }
  const role = readJwtRole(value);
  if (role === undefined) {
    ctx.addIssue({
      code: 'custom',
      message: 'tiene que ser una secret key (sb_secret_...) o la service_role key JWT (legacy)',
    });
  } else if (role !== 'service_role') {
    ctx.addIssue({
      code: 'custom',
      message: 'es un JWT sin rol service_role (¿pusiste la anon key?)',
    });
  }
});

const envSchema = z.object({
  NODE_ENV: oneOf(NODE_ENVS).default('development'),
  HOST: text().regex(/^\S+$/, 'no puede tener espacios').default('0.0.0.0'),
  PORT: integer(1, 65_535, 4000),
  LOG_LEVEL: oneOf(LOG_LEVELS).default('info'),
  TRUST_PROXY: integer(0, 32, 0),
  CORS_ORIGINS: corsOriginsSchema,
  SUPABASE_URL: text()
    .refine(isHttpUrl, 'tiene que ser una URL http(s) válida')
    .transform((value) => value.replace(/\/+$/, '')),
  SUPABASE_SERVICE_ROLE_KEY: serviceRoleKeySchema,
  SUPABASE_JWT_SECRET: text().min(32, 'tiene que tener al menos 32 caracteres').optional(),
  ANTHROPIC_API_KEY: text().regex(
    /^sk-ant-[A-Za-z0-9_-]{8,}$/,
    'tiene que ser una API key de Anthropic (empieza con sk-ant-)',
  ),
  CLAUDE_MODEL: text()
    .regex(/^claude-[a-z0-9-]+$/, 'tiene que ser un ID de modelo de Claude (ej.: claude-opus-5-5)')
    .default('claude-opus-5-5'),
  CLAUDE_EFFORT: oneOf(CLAUDE_EFFORTS).default('medium'),
  STORAGE_MEDIA_BUCKET: text()
    .regex(
      /^[a-z0-9][a-z0-9._-]{0,62}$/,
      'tiene que ser un nombre de bucket válido (minúsculas, números, ".", "_" y "-")',
    )
    .default('profile-media'),
  SHUTDOWN_TIMEOUT_MS: integer(1000, 300_000, 10_000),
});

type ParsedEnv = z.output<typeof envSchema>;

export type Env = Readonly<Omit<ParsedEnv, 'CORS_ORIGINS'> & { CORS_ORIGINS: readonly string[] }>;
export type NodeEnv = Env['NODE_ENV'];
export type LogLevel = Env['LOG_LEVEL'];
export type ClaudeEffort = Env['CLAUDE_EFFORT'];

export const ENV_VARS = Object.keys(envSchema.shape) as readonly (keyof ParsedEnv)[];

export interface EnvIssue {
  readonly variable: string;
  readonly message: string;
}

export class EnvValidationError extends Error {
  override readonly name = 'EnvValidationError';
  readonly issues: readonly EnvIssue[];

  constructor(issues: readonly EnvIssue[]) {
    const lines = issues.map((issue) => `  - ${issue.variable}: ${issue.message}`);
    super(`Variables de entorno inválidas o faltantes:\n${lines.join('\n')}`);
    this.issues = issues;
  }

  get variables(): string[] {
    return this.issues.map((issue) => issue.variable);
  }
}

/** Valida las variables de entorno y devuelve una configuración tipada e inmutable. */
export function loadEnv(source: Readonly<Record<string, string | undefined>> = process.env): Env {
  // Solo se leen las variables conocidas; una variable vacía cuenta como no definida
  const input: Record<string, string | undefined> = {};
  for (const name of ENV_VARS) {
    const value = source[name]?.trim();
    input[name] = value === '' ? undefined : value;
  }

  const result = envSchema.safeParse(input);
  if (!result.success) {
    throw new EnvValidationError(collectIssues(result.error));
  }

  return Object.freeze({
    ...result.data,
    CORS_ORIGINS: Object.freeze([...result.data.CORS_ORIGINS]),
  });
}

let cachedEnv: Env | undefined;

/** Igual que loadEnv() sobre process.env, pero valida una sola vez por proceso. */
export function getEnv(): Env {
  cachedEnv ??= loadEnv();
  return cachedEnv;
}

/**
 * Carga un archivo .env en process.env sin pisar variables ya definidas.
 * Si el archivo no existe no hace nada (en producción las variables vienen del entorno).
 * Devuelve true si lo cargó.
 */
export function loadDotenvFile(path: string): boolean {
  try {
    process.loadEnvFile(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function collectIssues(error: z.ZodError): EnvIssue[] {
  // Agrupa por variable, en el orden del esquema
  const byVariable = new Map<string, string[]>();
  for (const issue of error.issues) {
    const variable = String(issue.path[0] ?? 'env');
    const messages = byVariable.get(variable) ?? [];
    messages.push(issue.message);
    byVariable.set(variable, messages);
  }
  return [...byVariable].map(([variable, messages]) => ({
    variable,
    message: messages.join('; '),
  }));
}
