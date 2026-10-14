import { describe, expect, it } from 'vitest';
import { describeFailure, describeIssue, describeLineError, describeWarning } from '@/shared/messages';

describe('mensajes para la persona', () => {
  it('muestra las páginas contando desde 1', () => {
    expect(describeWarning({ code: 'page-unavailable', detail: '1' })).toBe('No se pudo leer la página 2.');
    expect(describeWarning({ code: 'sequential-navigation', detail: '0' })).toBe(
      'Navegación secuencial: sólo se exportó la página 1.',
    );
    expect(describeIssue({ number: 7, reason: 'other-page', page: 1 })).toBe(
      'Pregunta 7: está en la página 2. Ve a esa página y vuelve a aplicar.',
    );
  });

  it('describe cada aviso de exportación', () => {
    expect(describeWarning({ code: 'unsupported-question', detail: '2' })).toBe(
      'La pregunta 2 tiene un tipo no soportado; se exportó sin opciones.',
    );
    expect(describeWarning({ code: 'image-not-downloaded', detail: 'https://x.test/a.png' })).toBe(
      'No se descargó la imagen https://x.test/a.png; se enlaza la dirección original.',
    );
  });

  it('describe cada problema del autollenado', () => {
    expect(describeIssue({ number: 3, reason: 'not-in-quiz' })).toBe('Pregunta 3: no existe en este cuestionario.');
    expect(describeIssue({ number: 3, reason: 'unsupported' })).toBe('Pregunta 3: su tipo no se puede autollenar.');
    expect(describeIssue({ number: 3, reason: 'unknown-letter', letter: 'z' })).toBe('Pregunta 3: la opción «z» no existe.');
    expect(describeIssue({ number: 3, reason: 'too-many-letters' })).toBe(
      'Pregunta 3: admite una sola respuesta y la lista trae varias.',
    );
    expect(describeLineError({ line: 4, text: '4. hola', reason: 'format' })).toBe('Línea 4: formato no reconocido («4. hola»).');
    expect(describeLineError({ line: 5, text: '1. b', reason: 'duplicate' })).toBe(
      'Línea 5: esa pregunta ya tenía respuesta en una línea anterior.',
    );
    expect(describeFailure({ number: 2, reason: 'missing-input' })).toBe('Pregunta 2: no se encontró el control en la página.');
    expect(describeFailure({ number: 2, reason: 'not-confirmed' })).toBe('Pregunta 2: no se pudo confirmar la selección.');
  });
});
