import { describe, expect, it } from 'vitest';
import { cleanUrl, normalizeSpace } from '@/shared/text';

describe('normalizeSpace', () => {
  it('colapsa espacios, saltos de línea y &nbsp; en un solo espacio', () => {
    expect(normalizeSpace('  1C,  2A,\n\t3D  ')).toBe('1C, 2A, 3D');
  });

  it('devuelve cadena vacía si sólo hay espacios', () => {
    expect(normalizeSpace(' \n ')).toBe('');
  });
});

describe('cleanUrl', () => {
  const base = 'https://moodle.example.test/mod/quiz/attempt.php?attempt=1';

  it('resuelve rutas relativas contra la página', () => {
    expect(cleanUrl('/pluginfile.php/1/a.png', base)).toBe('https://moodle.example.test/pluginfile.php/1/a.png');
  });

  it('quita la query y el fragmento para no guardar tokens', () => {
    expect(cleanUrl('https://moodle.example.test/x.png?token=abc&time=1#f', base)).toBe(
      'https://moodle.example.test/x.png',
    );
  });

  it('descarta esquemas que no son http(s)', () => {
    expect(cleanUrl('data:image/png;base64,AAAA', base)).toBeNull();
    expect(cleanUrl('javascript:alert(1)', base)).toBeNull();
  });

  it('descarta valores vacíos o nulos', () => {
    expect(cleanUrl(null, base)).toBeNull();
    expect(cleanUrl('   ', base)).toBeNull();
  });
});
