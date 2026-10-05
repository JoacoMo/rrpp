import { describe, expect, it } from 'vitest';
import {
  INSTAGRAM_USERNAME_REGEX,
  MAX_USERNAMES_PER_JOB,
  instagramUsernameSchema,
  isValidInstagramUsername,
  normalizeInstagramUsername,
  parseUsernameList,
} from '../src/index';

describe('INSTAGRAM_USERNAME_REGEX', () => {
  it('acepta minúsculas, números, punto y guion bajo, de 1 a 30 caracteres', () => {
    expect(INSTAGRAM_USERNAME_REGEX.test('a')).toBe(true);
    expect(INSTAGRAM_USERNAME_REGEX.test('juan.perez_99')).toBe(true);
    expect(INSTAGRAM_USERNAME_REGEX.test('a'.repeat(30))).toBe(true);
  });

  it('rechaza mayúsculas, otros símbolos, vacío y más de 30 caracteres', () => {
    expect(INSTAGRAM_USERNAME_REGEX.test('Juan')).toBe(false);
    expect(INSTAGRAM_USERNAME_REGEX.test('juan-perez')).toBe(false);
    expect(INSTAGRAM_USERNAME_REGEX.test('')).toBe(false);
    expect(INSTAGRAM_USERNAME_REGEX.test('a'.repeat(31))).toBe(false);
  });
});

describe('isValidInstagramUsername', () => {
  it.each(['juan', 'juan.perez', 'juan_perez', '_juan_', '123', 'a.b.c'])('acepta %s', (name) => {
    expect(isValidInstagramUsername(name)).toBe(true);
  });

  it.each(['.juan', 'juan.', 'juan..perez', '.', '..', 'Juan', 'juan perez', ''])(
    'rechaza %j',
    (name) => {
      expect(isValidInstagramUsername(name)).toBe(false);
    },
  );
});

describe('normalizeInstagramUsername', () => {
  it.each([
    ['user', 'user'],
    ['@user', 'user'],
    ['User', 'user'],
    ['@Juan.Perez_99', 'juan.perez_99'],
    ['  user  ', 'user'],
    ['instagram.com/user', 'user'],
    ['www.instagram.com/user', 'user'],
    ['m.instagram.com/user/', 'user'],
    ['instagr.am/user', 'user'],
    ['https://www.instagram.com/user/?hl=es', 'user'],
    ['https://www.instagram.com/User/', 'user'],
    ['http://instagram.com/user', 'user'],
    ['https://instagram.com/user?igsh=MTB2eXZ5', 'user'],
    ['https://www.instagram.com/user/#posts', 'user'],
    ['https://www.instagram.com/user/reels/', 'user'],
    ['https://www.instagram.com/user/tagged/', 'user'],
    ['https://www.instagram.com/_u/user', 'user'],
    ['HTTPS://WWW.INSTAGRAM.COM/USER', 'user'],
    ['ig.me/m/user', 'user'],
    ['https://ig.me/m/user', 'user'],
    ['ig.me/user', 'user'],
    ['instagram.com/%40user', 'user'],
    ['a'.repeat(30), 'a'.repeat(30)],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeInstagramUsername(raw)).toBe(expected);
  });

  it.each([
    ['vacío', ''],
    ['solo espacios', '   '],
    ['solo arroba', '@'],
    ['punto al principio', '.user'],
    ['punto al final', 'user.'],
    ['puntos seguidos', 'us..er'],
    ['guion medio', 'juan-perez'],
    ['espacio en el medio', 'juan perez'],
    ['acentos', 'josé'],
    ['más de 30 caracteres', 'a'.repeat(31)],
    ['doble arroba', '@@user'],
    ['post', 'https://www.instagram.com/p/C1a2B3c4D5e/'],
    ['reel', 'https://www.instagram.com/reel/C1a2B3c4D5e/'],
    ['reels', 'instagram.com/reels/C1a2B3c4D5e'],
    ['explore', 'https://www.instagram.com/explore/tags/cordoba/'],
    ['historia', 'https://www.instagram.com/stories/user/3141592653589793238/'],
    ['configuración de cuenta', 'https://www.instagram.com/accounts/edit/'],
    ['bandeja de mensajes', 'https://www.instagram.com/direct/inbox/'],
    ['IGTV', 'https://www.instagram.com/tv/C1a2B3c4D5e/'],
    ['link para compartir', 'https://www.instagram.com/share/BAabcdef'],
    ['instagram.com sin usuario', 'https://www.instagram.com/'],
    ['dominio pelado', 'instagram.com'],
    ['dominio pelado con www', 'www.instagram.com'],
    ['ig.me sin usuario', 'ig.me/m/'],
    ['otra red social', 'https://twitter.com/user'],
    ['dominio parecido', 'https://instagram.com.evil.example/user'],
    ['protocolo no web', 'ftp://instagram.com/user'],
    ['javascript', 'javascript:alert(1)'],
    ['URL inválida', 'https://'],
    ['usuario inválido dentro de la URL', 'https://www.instagram.com/juan..perez/'],
  ])('rechaza %s', (_case, raw) => {
    expect(normalizeInstagramUsername(raw)).toBeNull();
  });
});

describe('parseUsernameList', () => {
  it('separa por saltos de línea, comas, punto y coma y espacios', () => {
    const text = '@uno\ndos, tres;cuatro cinco\r\nseis\tsiete';
    expect(parseUsernameList(text)).toEqual({
      valid: ['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete'],
      invalid: [],
      truncated: false,
    });
  });

  it('acepta mezclas de @usuarios y URLs', () => {
    const text = [
      '@Juan.Perez',
      'https://www.instagram.com/maria_gomez/?hl=es',
      'ig.me/m/lucas',
      'instagram.com/sofi.cba',
    ].join('\n');
    expect(parseUsernameList(text).valid).toEqual([
      'juan.perez',
      'maria_gomez',
      'lucas',
      'sofi.cba',
    ]);
  });

  it('deduplica conservando el orden de la primera aparición', () => {
    const text = 'b\na\n@B\nhttps://instagram.com/a/\nc';
    expect(parseUsernameList(text).valid).toEqual(['b', 'a', 'c']);
  });

  it('devuelve las entradas inválidas tal como vinieron, sin repetir', () => {
    const text = 'ok\n.malo\nhttps://www.instagram.com/p/abc/\n.malo\notro-malo';
    expect(parseUsernameList(text)).toEqual({
      valid: ['ok'],
      invalid: ['.malo', 'https://www.instagram.com/p/abc/', 'otro-malo'],
      truncated: false,
    });
  });

  it('ignora líneas vacías y espacios de ancho cero', () => {
    const text = '\n\n  uno  \n\u200B\n\uFEFFdos\n,,;;\n';
    expect(parseUsernameList(text)).toEqual({
      valid: ['uno', 'dos'],
      invalid: [],
      truncated: false,
    });
  });

  it('devuelve listas vacías para un texto vacío', () => {
    expect(parseUsernameList('')).toEqual({ valid: [], invalid: [], truncated: false });
  });

  it('corta en max y avisa con truncated', () => {
    const result = parseUsernameList('a b c d e', 3);
    expect(result.valid).toEqual(['a', 'b', 'c']);
    expect(result.truncated).toBe(true);
  });

  it('no marca truncated si los sobrantes son duplicados', () => {
    const result = parseUsernameList('a b c a b c', 3);
    expect(result.valid).toEqual(['a', 'b', 'c']);
    expect(result.truncated).toBe(false);
  });

  it('sigue juntando inválidos después de llegar a max', () => {
    const result = parseUsernameList('a b c .malo', 2);
    expect(result).toEqual({ valid: ['a', 'b'], invalid: ['.malo'], truncated: true });
  });

  it(`usa ${MAX_USERNAMES_PER_JOB} como máximo por defecto`, () => {
    const names = Array.from({ length: MAX_USERNAMES_PER_JOB + 5 }, (_, i) => `user${i}`);
    const result = parseUsernameList(names.join('\n'));
    expect(result.valid).toHaveLength(MAX_USERNAMES_PER_JOB);
    expect(result.valid.at(-1)).toBe(`user${MAX_USERNAMES_PER_JOB - 1}`);
    expect(result.truncated).toBe(true);
  });

  it.each([0, -1, 1.5, Number.NaN])('rechaza max = %s', (max) => {
    expect(() => parseUsernameList('a', max)).toThrow(RangeError);
  });
});

describe('instagramUsernameSchema', () => {
  it('normaliza el valor', () => {
    expect(instagramUsernameSchema.parse('https://www.instagram.com/Juan.Perez/')).toBe(
      'juan.perez',
    );
  });

  it('falla con un mensaje en español', () => {
    const result = instagramUsernameSchema.safeParse('https://www.instagram.com/p/abc/');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('No es un usuario de Instagram válido.');
  });

  it('rechaza lo que no es texto', () => {
    expect(instagramUsernameSchema.safeParse(42).success).toBe(false);
  });
});
