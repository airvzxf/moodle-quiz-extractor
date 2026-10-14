# moodle-quiz-extractor

Extensión para **Firefox y Chrome** que exporta un intento de cuestionario de Moodle a
**Markdown, JSON e imágenes** (en un ZIP) y que **autollena respuestas** a partir de una
lista en texto plano. **Nunca envía el intento**: el envío final siempre lo haces tú.

> **Local.** Todo ocurre en tu navegador con tu sesión de Moodle. La extensión no
> manda tus cuestionarios ni tus respuestas a ningún servidor.

## Qué hace

- **Exportar** (botón *Descargar ZIP*): lee el intento abierto y, si tiene varias páginas
  con navegación libre, también las demás. Descarga `<curso-unidad-titulo>.zip` con:
  - `quiz.md`: el cuestionario legible;
  - `quiz.json`: los mismos datos en formato estructurado;
  - `quiz/`: las imágenes del enunciado y de las opciones.
- **Modo detallado** (casilla): el Markdown marca con `[x]` lo que ya está seleccionado y
  añade datos técnicos (origen, páginas, tipo Moodle, instrucción, imágenes, avisos).
- **Autollenar**: pegas tus respuestas, pulsas *Revisar* para ver qué se aplicará y
  *Aplicar en esta página* para marcarlas. En un intento de varias páginas, ve a cada
  página y vuelve a pulsar *Aplicar*; la lista se conserva mientras dure la sesión del
  navegador.

Tipos soportados: opción única (incluye verdadero/falso) y opción múltiple. Las demás
preguntas se exportan con su enunciado y un aviso, y no se autollenan.

Con navegación **secuencial** Moodle no permite volver atrás, así que sólo se exporta la
página que estás viendo.

## Formato de la lista de respuestas

Una respuesta por línea: número, separador opcional y una o varias letras.

```text
1. a
2) c
3. a, c
4 b d
# las líneas que empiezan por # o // se ignoran
```

## Formato del Markdown

```markdown
# 02 – Sistemas operativos – DSOP | Unidad 1

## Actividad 1. Cuestionario

Metadata
Desconocido: Actividad_1._Cuestionario

---

### 2. Relaciona las siguientes columnas:
[IMAGEN](./quiz/A2_Examen_U1.png)
#### Respuestas
Selecciona una opción:
[ ] a. 1A, 2C, 3D, 4B.
[ ] b. 1C, 2A, 3D, 4B.

Metadata
Tipo de respuesta: single_choice.
Puntaje de 10.00
Sin responder aún
```

## Permisos

| Permiso | Para qué |
|---|---|
| `activeTab` + `scripting` | Leer la pestaña de Moodle **sólo cuando pulsas el icono**. |
| `downloads` | Guardar el ZIP. |
| `storage` | Recordar tu lista de respuestas durante la sesión del navegador (`storage.session`). |

No pide acceso a todos los sitios, ni cookies, ni recoge datos.

## Desarrollo

Requisitos: Node.js 24 o superior y pnpm 12.

```bash
pnpm install
pnpm exec wxt prepare
pnpm compile          # TypeScript estricto
pnpm test             # Vitest + jsdom
pnpm build:firefox    # .output/firefox-mv3
pnpm build:chrome     # .output/chrome-mv3
pnpm smoke:chrome     # prueba de humo con Chromium y un Moodle falso local
pnpm smoke:firefox    # prueba de humo con Firefox (WebDriver BiDi)
```

Cargar en Firefox: `about:debugging#/runtime/this-firefox` → *Cargar complemento
temporal…* → `.output/firefox-mv3/manifest.json`.
Cargar en Chrome: `chrome://extensions` → *Modo de desarrollador* → *Cargar
descomprimida* → `.output/chrome-mv3`.

### Fixtures de prueba

`tests/fixtures/` guarda páginas reales **reducidas y sin datos personales**. Para añadir
una nueva, guarda la página del intento como HTML en `resources/` (ignorada por git) y
ejecuta:

```bash
node tools/make-fixture.mjs resources/pagina.html tests/fixtures/nombre.html
```

## Licencia

[GNU AGPL v3](LICENSE).
