import { describe, expect, it } from 'vitest';
import {
  ANTHROPIC_MAX_RETRIES,
  ANTHROPIC_TIMEOUT_MS,
  createAnthropicClient,
  getClaudeConfig,
} from '../../src/lib/anthropic';
import { TEST_SECRETS, buildEnv } from '../helpers/env';

describe('createAnthropicClient', () => {
  it('usa la API key del entorno, 3 reintentos y 120 s de timeout', () => {
    const client = createAnthropicClient(buildEnv());
    expect(client.apiKey).toBe(TEST_SECRETS.anthropicApiKey);
    expect(client.maxRetries).toBe(ANTHROPIC_MAX_RETRIES);
    expect(client.maxRetries).toBe(3);
    expect(client.timeout).toBe(ANTHROPIC_TIMEOUT_MS);
    expect(client.timeout).toBe(120_000);
  });
});

describe('getClaudeConfig', () => {
  it('por defecto usa Claude Opus 5.5 con esfuerzo medium', () => {
    expect(getClaudeConfig(buildEnv())).toEqual({ model: 'claude-opus-5-5', effort: 'medium' });
  });

  it('toma modelo y esfuerzo del entorno y devuelve un objeto congelado', () => {
    const config = getClaudeConfig(
      buildEnv({ CLAUDE_MODEL: 'claude-sonnet-5-5', CLAUDE_EFFORT: 'high' }),
    );
    expect(config).toEqual({ model: 'claude-sonnet-5-5', effort: 'high' });
    expect(Object.isFrozen(config)).toBe(true);
  });
});
