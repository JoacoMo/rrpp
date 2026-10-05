import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

// Se acepta el id que manda un proxy o el cliente solo si es corto y seguro para los logs
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** genReqId de pino-http: reutiliza un x-request-id válido o genera un UUID, y lo devuelve en la respuesta. */
export function genReqId(req: IncomingMessage, res: ServerResponse): string {
  const header = req.headers[REQUEST_ID_HEADER];
  const incoming = Array.isArray(header) ? header[0] : header;
  const id = incoming !== undefined && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

/** Id del request asignado por pino-http. */
export function getRequestId(req: IncomingMessage): string {
  const id: unknown = req.id;
  if (typeof id === 'string') return id;
  if (typeof id === 'number') return String(id);
  return 'unknown';
}
