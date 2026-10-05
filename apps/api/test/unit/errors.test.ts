import { PostgrestError } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import {
  AppError,
  DOMAIN_ERROR_CODES,
  ERROR_CATALOG,
  ErrorCode,
  fromPostgrestError,
  isAppError,
  isDomainErrorCode,
} from '../../src/lib/errors';

const INTERNAL_DB_MESSAGE = 'relation "public.secret_table" does not exist';

function pgError(code: string, message = INTERNAL_DB_MESSAGE, details = ''): PostgrestError {
  return new PostgrestError({ code, message, details, hint: '' });
}

describe('catálogo de errores', () => {
  it('tiene una definición para cada código', () => {
    expect(Object.keys(ERROR_CATALOG).sort()).toEqual(Object.values(ErrorCode).sort());
  });

  it.each(Object.entries(ERROR_CATALOG))(
    '%s tiene status HTTP de error y mensaje',
    (_code, def) => {
      expect(def.status).toBeGreaterThanOrEqual(400);
      expect(def.status).toBeLessThan(600);
      expect(def.message.trim()).not.toBe('');
    },
  );

  it.each([
    ['BAD_REQUEST', 400],
    ['INVALID_JSON', 400],
    ['UNAUTHORIZED', 401],
    ['FORBIDDEN', 403],
    ['NOT_FOUND', 404],
    ['CONFLICT', 409],
    ['PAYLOAD_TOO_LARGE', 413],
    ['VALIDATION_ERROR', 422],
    ['REFERENCE_NOT_FOUND', 422],
    ['CONSTRAINT_VIOLATION', 422],
    ['RATE_LIMITED', 429],
    ['INTERNAL', 500],
    ['SERVICE_UNAVAILABLE', 503],
    ['ACCOUNT_NOT_FOUND', 404],
    ['ITEM_NOT_FOUND', 404],
    ['ITEM_NOT_CLAIMED', 409],
    ['PROSPECT_NOT_FOUND', 404],
    ['EVENT_NOT_FOUND', 404],
    ['ICEBREAKER_NOT_FOUND', 404],
    ['JOB_NOT_FOUND', 404],
    ['INVALID_TRANSITION', 409],
    ['SCAN_NOT_FOUND', 404],
    ['SCAN_NOT_UPLOADING', 409],
    ['SCAN_INCOMPLETE', 409],
    ['INVALID_ARGUMENT', 422],
  ] as const)('%s → %i', (code, status) => {
    expect(ERROR_CATALOG[code].status).toBe(status);
  });

  it('isDomainErrorCode distingue los códigos de dominio', () => {
    for (const code of DOMAIN_ERROR_CODES) expect(isDomainErrorCode(code)).toBe(true);
    expect(isDomainErrorCode('NOT_FOUND')).toBe(false);
    expect(isDomainErrorCode('account_not_found')).toBe(false);
  });
});

describe('AppError', () => {
  it('toma status y mensaje del catálogo', () => {
    const error = new AppError(ErrorCode.EVENT_NOT_FOUND);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AppError');
    expect(error.code).toBe('EVENT_NOT_FOUND');
    expect(error.status).toBe(404);
    expect(error.message).toBe(ERROR_CATALOG.EVENT_NOT_FOUND.message);
    expect(error.details).toBeUndefined();
    expect(error.cause).toBeUndefined();
    expect(error.expose).toBe(true);
  });

  it('acepta mensaje, detalles y causa', () => {
    const cause = new Error('original');
    const error = new AppError(ErrorCode.CONFLICT, {
      message: 'Ya cargaste esa cuenta.',
      details: { field: 'username' },
      cause,
    });
    expect(error.message).toBe('Ya cargaste esa cuenta.');
    expect(error.details).toEqual({ field: 'username' });
    expect(error.cause).toBe(cause);
  });

  it('no expone los 5xx salvo que se pida', () => {
    expect(new AppError(ErrorCode.INTERNAL).expose).toBe(false);
    expect(new AppError(ErrorCode.SERVICE_UNAVAILABLE).expose).toBe(false);
    expect(new AppError(ErrorCode.SERVICE_UNAVAILABLE, { expose: true }).expose).toBe(true);
    expect(new AppError(ErrorCode.BAD_REQUEST, { expose: false }).expose).toBe(false);
  });

  it('isAppError reconoce solo instancias de AppError', () => {
    expect(isAppError(new AppError(ErrorCode.NOT_FOUND))).toBe(true);
    expect(isAppError(new Error('x'))).toBe(false);
    expect(isAppError({ code: 'NOT_FOUND', status: 404 })).toBe(false);
    expect(isAppError(null)).toBe(false);
  });
});

describe('fromPostgrestError', () => {
  it.each([
    ['PGRST116', 'NOT_FOUND', 404],
    ['23505', 'CONFLICT', 409],
    ['23503', 'REFERENCE_NOT_FOUND', 422],
    ['23514', 'CONSTRAINT_VIOLATION', 422],
    ['22P02', 'BAD_REQUEST', 400],
  ] as const)('%s → %s (%i)', (pgCode, code, status) => {
    const original = pgError(pgCode);
    const error = fromPostgrestError(original);
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
    expect(error.expose).toBe(true);
    expect(error.cause).toBe(original);
    // El mensaje interno de la base nunca llega al cliente
    expect(error.message).toBe(ERROR_CATALOG[code].message);
    expect(error.details).toBeUndefined();
  });

  it.each(DOMAIN_ERROR_CODES)('P0001 con %s → ese código, con los detalles de la base', (code) => {
    const original = pgError('P0001', code, 'detalle de la función');
    const error = fromPostgrestError(original);
    expect(error.code).toBe(code);
    expect(error.status).toBe(ERROR_CATALOG[code].status);
    expect(error.message).toBe(ERROR_CATALOG[code].message);
    expect(error.details).toBe('detalle de la función');
    expect(error.expose).toBe(true);
    expect(error.cause).toBe(original);
  });

  it('P0001 interpreta los detalles en JSON', () => {
    const error = fromPostgrestError(
      pgError('P0001', 'INVALID_TRANSITION', '{"from":"new","to":"bought_ticket"}'),
    );
    expect(error.details).toEqual({ from: 'new', to: 'bought_ticket' });
  });

  it('P0001 conserva como texto un detalle que parece JSON pero no lo es', () => {
    const error = fromPostgrestError(pgError('P0001', 'INVALID_ARGUMENT', '{no es json'));
    expect(error.details).toBe('{no es json');
  });

  it('P0001 sin detalles no agrega details', () => {
    expect(fromPostgrestError(pgError('P0001', 'JOB_NOT_FOUND', '')).details).toBeUndefined();
  });

  it('P0001 tolera espacios alrededor del código', () => {
    expect(fromPostgrestError(pgError('P0001', '  SCAN_INCOMPLETE \n')).code).toBe(
      'SCAN_INCOMPLETE',
    );
  });

  it.each([
    ['un mensaje desconocido', 'algo se rompió en la función'],
    ['un código genérico que no es de dominio', 'NOT_FOUND'],
    ['un código en minúsculas', 'account_not_found'],
  ])('P0001 con %s → INTERNAL sin exponer', (_case, message) => {
    const original = pgError('P0001', message, 'detalle interno');
    const error = fromPostgrestError(original);
    expect(error.code).toBe('INTERNAL');
    expect(error.status).toBe(500);
    expect(error.expose).toBe(false);
    expect(error.details).toBeUndefined();
    expect(error.cause).toBe(original);
  });

  it.each(['42501', '42P01', 'PGRST301', '57014', ''])('%j → INTERNAL sin exponer', (pgCode) => {
    const original = pgError(pgCode);
    const error = fromPostgrestError(original);
    expect(error.code).toBe('INTERNAL');
    expect(error.expose).toBe(false);
    expect(error.message).not.toContain(INTERNAL_DB_MESSAGE);
    expect(error.cause).toBe(original);
  });

  it('acepta errores planos con la forma de PostgrestError', () => {
    const error = fromPostgrestError({ code: '23505', message: 'dup', details: '', hint: '' });
    expect(error.code).toBe('CONFLICT');
  });
});
