import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServiceClient, pingDatabase, type ServiceClient } from '../../src/lib/supabase';
import { TEST_SECRETS } from '../helpers/env';

// PostgREST falso: registra cada request y responde lo que diga el test
type Responder = (req: IncomingMessage, res: ServerResponse) => void;

interface ReceivedRequest {
  method: string | undefined;
  url: URL;
  headers: IncomingHttpHeaders;
}

const received: ReceivedRequest[] = [];
let respond: Responder;
let server: Server;
let baseUrl: string;

function listen(target: Server): Promise<string> {
  return new Promise((resolve) => {
    target.listen(0, '127.0.0.1', () => {
      const { port } = target.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function close(target: Server): Promise<void> {
  target.closeAllConnections();
  return new Promise((resolve, reject) => {
    target.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function clientFor(url: string): ServiceClient {
  return createServiceClient({
    SUPABASE_URL: url,
    SUPABASE_SERVICE_ROLE_KEY: TEST_SECRETS.serviceRoleKey,
  });
}

beforeAll(async () => {
  server = createServer((req, res) => {
    received.push({
      method: req.method,
      url: new URL(req.url ?? '/', 'http://localhost'),
      headers: req.headers,
    });
    respond(req, res);
  });
  baseUrl = await listen(server);
});

afterAll(async () => {
  await close(server);
});

beforeEach(() => {
  received.length = 0;
  respond = (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Range': '*/*' }).end();
  };
});

describe('createServiceClient + pingDatabase', () => {
  it('hace un HEAD barato sobre profiles con la service key y se identifica como rrpp-api', async () => {
    const result = await pingDatabase(clientFor(baseUrl));

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);

    expect(received).toHaveLength(1);
    const [req] = received;
    expect(req?.method).toBe('HEAD');
    expect(req?.url.pathname).toBe('/rest/v1/profiles');
    expect(req?.url.searchParams.get('select')).toBe('id');
    expect(req?.url.searchParams.get('limit')).toBe('1');
    expect(req?.headers.apikey).toBe(TEST_SECRETS.serviceRoleKey);
    expect(req?.headers['x-client-info']).toBe('rrpp-api');
  });

  it('devuelve ok=false si PostgREST responde con error', async () => {
    respond = (_req, res) => {
      res.writeHead(503).end();
    };
    const result = await pingDatabase(clientFor(baseUrl));
    expect(result.ok).toBe(false);
    expect(result.error).toEqual(expect.any(String));
  });

  it('corta por timeout si la base no responde', async () => {
    respond = () => {
      // No responde nunca: el ping tiene que abortar solo
    };
    const result = await pingDatabase(clientFor(baseUrl), 50);
    expect(result).toEqual({
      ok: false,
      latencyMs: expect.any(Number),
      error: 'timeout after 50ms',
    });
    expect(result.latencyMs).toBeGreaterThanOrEqual(45);
    expect(result.latencyMs).toBeLessThan(2000);
  });

  it('devuelve ok=false si no hay conexión', async () => {
    const closed = createServer();
    const closedUrl = await listen(closed);
    await close(closed);

    const result = await pingDatabase(clientFor(closedUrl));
    expect(result.ok).toBe(false);
    expect(result.error).toEqual(expect.any(String));
  });

  it('nunca lanza, aunque el cliente lance', async () => {
    const broken = {
      from: () => {
        throw new Error('cliente roto');
      },
    } as unknown as ServiceClient;
    await expect(pingDatabase(broken)).resolves.toEqual({
      ok: false,
      latencyMs: expect.any(Number),
      error: 'cliente roto',
    });
  });
});
