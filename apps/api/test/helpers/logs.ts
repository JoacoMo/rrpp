import type { DestinationStream } from 'pino';

export type LogEntry = Record<string, unknown>;

export interface CapturedLogs {
  stream: DestinationStream;
  entries: LogEntry[];
}

/** Destino de pino que guarda cada línea parseada, para inspeccionar los logs en los tests. */
export function captureLogs(): CapturedLogs {
  const entries: LogEntry[] = [];
  return {
    entries,
    stream: {
      write(line: string) {
        entries.push(JSON.parse(line) as LogEntry);
      },
    },
  };
}
