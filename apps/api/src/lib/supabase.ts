import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@rrpp/shared';
import type { Env } from '../config/env';

export type ServiceClient = SupabaseClient<Database>;

export interface PingResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

/** Cliente con la service role: saltea RLS, así que solo vive en el servidor. */
export function createServiceClient(
  env: Pick<Env, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'>,
): ServiceClient {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    // Misma capitalización que el default de supabase-js para reemplazarlo en vez de sumarse
    global: { headers: { 'X-Client-Info': 'rrpp-api' } },
  });
}

/** Consulta mínima contra la base para /readyz. Nunca lanza: devuelve ok=false con el motivo. */
export async function pingDatabase(client: ServiceClient, timeoutMs = 3000): Promise<PingResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  const startedAt = performance.now();
  const elapsed = (): number => Math.round(performance.now() - startedAt);

  try {
    // HEAD sin conteo: PostgREST resuelve la consulta pero no devuelve filas
    const { error } = await client
      .from('profiles')
      .select('id', { head: true })
      .limit(1)
      .abortSignal(controller.signal);

    if (controller.signal.aborted) {
      return { ok: false, latencyMs: elapsed(), error: `timeout after ${timeoutMs}ms` };
    }
    if (error !== null) {
      const code = error.code === '' ? 'unknown' : error.code;
      return { ok: false, latencyMs: elapsed(), error: `${code}: ${error.message}` };
    }
    return { ok: true, latencyMs: elapsed() };
  } catch (error) {
    const message = controller.signal.aborted
      ? `timeout after ${timeoutMs}ms`
      : error instanceof Error
        ? error.message
        : 'unknown error';
    return { ok: false, latencyMs: elapsed(), error: message };
  } finally {
    clearTimeout(timer);
  }
}
