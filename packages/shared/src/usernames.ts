import { z } from 'zod';

/** Usuario de Instagram ya normalizado: minúsculas, letras, números, punto y guion bajo. */
export const INSTAGRAM_USERNAME_REGEX = /^[a-z0-9._]{1,30}$/;

/** Máximo de usuarios por carga (ver docs/ARCHITECTURE.md, flujo 4.1). */
export const MAX_USERNAMES_PER_JOB = 200;

const INSTAGRAM_HOSTS = new Set([
  'instagram.com',
  'www.instagram.com',
  'm.instagram.com',
  'instagr.am',
  'www.instagr.am',
]);
const IG_ME_HOSTS = new Set(['ig.me', 'www.ig.me']);

// Primer segmento de ruta de instagram.com que no es un perfil (posts, reels, historias, etc.)
const NON_PROFILE_PATHS = new Set([
  'p',
  'reel',
  'reels',
  'explore',
  'stories',
  'accounts',
  'direct',
  'tv',
  's',
  'share',
  'about',
  'legal',
  'developer',
  'challenge',
  'privacy',
  'session',
  'oauth',
  'emails',
  'web',
  'api',
  'graphql',
]);

// Prefijos de deep links de la app: instagram.com/_u/usuario
const APP_LINK_PREFIXES = new Set(['_u', '_n']);

const URL_SCHEME_REGEX = /^[a-z][a-z0-9+.-]*:\/\//i;

// Saltos de línea, espacios (incluidos los de ancho cero que pegan los celulares), comas y punto y coma
const LIST_SEPARATORS = /[\s,;\u200B-\u200D\uFEFF]+/;

/** Valida un usuario ya en minúsculas con las reglas de Instagram. */
export function isValidInstagramUsername(username: string): boolean {
  return (
    INSTAGRAM_USERNAME_REGEX.test(username) &&
    !username.startsWith('.') &&
    !username.endsWith('.') &&
    !username.includes('..')
  );
}

/**
 * Convierte "@Usuario", "usuario", "instagram.com/usuario", "https://www.instagram.com/usuario/?hl=es"
 * o "ig.me/m/usuario" en "usuario". Devuelve null si no es un perfil válido.
 */
export function normalizeInstagramUsername(raw: string): string | null {
  const input = raw.trim();
  if (input === '') return null;

  const candidate = looksLikeUrl(input) ? extractUsernameFromUrl(input) : stripAt(input);
  if (candidate === null) return null;

  const username = candidate.toLowerCase();
  // "instagram.com" pegado solo no es un usuario
  if (INSTAGRAM_HOSTS.has(username) || IG_ME_HOSTS.has(username)) return null;

  return isValidInstagramUsername(username) ? username : null;
}

export interface ParsedUsernameList {
  /** Usuarios normalizados, sin duplicados y en el orden en que aparecieron. */
  valid: string[];
  /** Entradas que no se pudieron interpretar, tal como vinieron (sin duplicados). */
  invalid: string[];
  /** true si había más usuarios válidos distintos que `max` y se descartó el resto. */
  truncated: boolean;
}

/** Separa un texto pegado (líneas, comas, punto y coma o espacios) en usuarios normalizados. */
export function parseUsernameList(
  text: string,
  max: number = MAX_USERNAMES_PER_JOB,
): ParsedUsernameList {
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError('max tiene que ser un entero mayor o igual a 1');
  }

  const valid: string[] = [];
  const invalid: string[] = [];
  const seenValid = new Set<string>();
  const seenInvalid = new Set<string>();
  let truncated = false;

  for (const token of text.split(LIST_SEPARATORS)) {
    if (token === '') continue;

    const username = normalizeInstagramUsername(token);
    if (username === null) {
      if (!seenInvalid.has(token)) {
        seenInvalid.add(token);
        invalid.push(token);
      }
      continue;
    }

    if (seenValid.has(username)) continue;
    if (valid.length >= max) {
      truncated = true;
      continue;
    }
    seenValid.add(username);
    valid.push(username);
  }

  return { valid, invalid, truncated };
}

/** Esquema zod que acepta cualquier formato soportado y devuelve el usuario normalizado. */
export const instagramUsernameSchema = z.string().transform((value, ctx) => {
  const username = normalizeInstagramUsername(value);
  if (username === null) {
    ctx.addIssue({ code: 'custom', message: 'No es un usuario de Instagram válido.' });
    return z.NEVER;
  }
  return username;
});

function looksLikeUrl(input: string): boolean {
  return input.includes('/') || URL_SCHEME_REGEX.test(input);
}

function stripAt(value: string): string {
  return value.startsWith('@') ? value.slice(1) : value;
}

function extractUsernameFromUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(URL_SCHEME_REGEX.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const segments = url.pathname
    .split('/')
    .filter((segment) => segment !== '')
    .map(safeDecode);

  if (IG_ME_HOSTS.has(url.hostname)) {
    // ig.me/m/usuario (abre el chat) o ig.me/usuario
    const [first, second] = segments;
    const username = first === 'm' ? second : first;
    return username === undefined ? null : stripAt(username);
  }

  if (!INSTAGRAM_HOSTS.has(url.hostname)) return null;

  let [first] = segments;
  if (first !== undefined && APP_LINK_PREFIXES.has(first)) first = segments[1];
  if (first === undefined || NON_PROFILE_PATHS.has(first.toLowerCase())) return null;

  return stripAt(first);
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
