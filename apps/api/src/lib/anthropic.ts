import Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../config/env';

export interface ClaudeConfig {
  readonly model: Anthropic.Model;
  // Tipado con el SDK: si CLAUDE_EFFORT acepta un nivel que la API no conoce, no compila
  readonly effort: NonNullable<Anthropic.OutputConfig['effort']>;
}

export const ANTHROPIC_MAX_RETRIES = 3;
export const ANTHROPIC_TIMEOUT_MS = 120_000;

/** Cliente de la API de Claude. Reintenta 429, 5xx y errores de conexión. */
export function createAnthropicClient(env: Pick<Env, 'ANTHROPIC_API_KEY'>): Anthropic {
  return new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    maxRetries: ANTHROPIC_MAX_RETRIES,
    timeout: ANTHROPIC_TIMEOUT_MS,
  });
}

export function getClaudeConfig(env: Pick<Env, 'CLAUDE_MODEL' | 'CLAUDE_EFFORT'>): ClaudeConfig {
  return Object.freeze({ model: env.CLAUDE_MODEL, effort: env.CLAUDE_EFFORT });
}
