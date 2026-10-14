import { describe, expect, it } from 'vitest';
import { fromBase64, toBase64 } from '@/shared/base64';

describe('base64', () => {
  it('codifica con el alfabeto estándar y relleno', () => {
    expect(toBase64(new Uint8Array([77, 97]))).toBe('TWE=');
    expect(toBase64(new Uint8Array([]))).toBe('');
  });

  it('ida y vuelta conserva los bytes exactos, incluso en archivos grandes', () => {
    const bytes = new Uint8Array(200_000).map((_, i) => (i * 31) % 256);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });
});
