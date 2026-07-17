# moodle-quiz-extractor

Extensión de Firefox (MV3) para **exportar cuestionarios de Moodle a Markdown local** con imágenes descargadas y, opcionalmente, **autollenado seguro de respuestas** a partir de una lista en texto plano.

> **Local-first.** La extensión nunca envía tus cuestionarios ni respuestas a ningún servidor. Procesa todo dentro del navegador con tu sesión de Moodle activa.

---

## Características (MVP)

- Extracción de un cuestionario a un archivo Markdown autocontenido.
- Descarga de las imágenes referenciadas y empaquetado en un ZIP junto al `.md`, un `.json` canónico y un manifiesto.
- Detección automática de la página de intento (`/mod/quiz/attempt.php*`).
- Redacción automática de secretos (`sesskey`, `MoodleSession`, `attempt`, `cmid`) en cualquier artefacto que salga de la extensión.
- **Autollenado seguro** desde una lista en texto plano (radio, checkbox, short_text, long_text, select). La extensión **nunca envía tu intento**; el submit final lo haces tú después de revisar.

## Fuera del MVP (post-release)

- Resolver preguntas (la IA no genera respuestas).
- Enviar automáticamente el intento final.
- Host Native Messaging / CLI (`moodlectl.py`) para que una IA en terminal pueda operar la extensión.
- Soporte Chromium, Safari, iOS, Firefox Android < 142.

---

## Contrato literal del Markdown generado

El archivo `quiz.md` producido sigue el contrato del ejemplo del usuario (literal, sin desviaciones):

```markdown
# 02 – Sistemas operativos – DSOP | Unidad 1

## Evaluación diagnóstica

Metadata
Desconocido: DU1_DSOP

---

### 1. Que es el cielo?

#### Respuestas
Selecciona una opción:
[ ] Donde esta diosito.
[ ] La parte visible que ve el ser humano con respecto a la biosfera.
[ ] Es azul.

Metadata
Tipo de respuesta: single_choice.
Puntaje de 10.00
Sin responder aún
Otra metadata.

---

### 2. Cuantos gatos hay en la imagen?
[IMAGEN](./quiz/gatos.png)

#### Respuestas
Selecciona una o mas opción:
[ ] 10.
[ ] Diez.
[ ] 1000/100.

Metadata
Tipo de respuesta: multiple_choice.
Puntaje de 10.00
Sin responder aún
Otra metadata.
```

> **No** se usa `- [ ]` (checklist GFM), **no** se añade frontmatter YAML, **no** se antepone `a. b. c.` a las opciones: el contrato es **literal** al ejemplo.
>
> El valor de `Tipo de respuesta:` es el identificador canónico del `Question.kind` (`single_choice`, `multiple_choice`, `short_text`, `long_text`, `select`, `unsupported`) — coincide 1-a-1 con el campo `kind` del `QuizDocument` JSON y del `manifest.json`, sin localización.

---

## Formato de respuestas (autollenado)

Texto plano, una respuesta por línea:

```text
1. a)
2. c)
3. a,c
4. d)
5. Mi respuesta se basa en los fundamentos del desarrollo del software.
```

Reglas:
- **Radio** (selección única): una sola letra (`a`, `a)`, `a.` son equivalentes).
- **Checkbox** (selección múltiple): letras separadas por comas (`a,c`).
- **Short text / Long text** (texto libre): todo lo que sigue al número (línea completa). Las preguntas `select` (dropdown) usan una sola letra.
- **Comentarios** y **líneas vacías** se ignoran.

### Cómo se aplica

1. Abre la pestaña **Autocompletar** del popup.
2. Pega tu lista en el textarea.
3. Pulsa **Validar respuestas**. La extensión comprueba que cada número corresponde a una pregunta extraída y que cada letra existe entre las opciones. Si algo no cuadra, te lo indica antes de tocar el DOM.
4. Pulsa **Aplicar respuestas**. La extensión marca las opciones / rellena los campos en la página real. Los spies internos (`MQX-FILL-304`, `MQX-FILL-305`) bloquean cualquier intento accidental de submit.
5. **Revisa visualmente** la página. Cuando estés conforme, pulsa el botón **Finalizar intento** de Moodle (la extensión no lo hace por ti).

> **Importante**: la extensión NUNCA envía tu intento. El submit final lo haces tú a mano después de revisar.

---

## Instalación de desarrollo

Requisitos: Node.js 20.19+ (recomendado LTS) y pnpm 10.13+.

```bash
pnpm install
pnpm prepare      # wxt prepare
pnpm compile      # type-check
pnpm test         # vitest run
pnpm build:firefox
pnpm zip:firefox
pnpm lint:ext     # web-ext lint sobre .output/firefox-mv3
```

Para cargar la extensión temporalmente en Firefox:

1. Visita `about:debugging#/runtime/this-firefox`
2. **Cargar complemento temporal…** y selecciona `.output/firefox-mv3/manifest.json`.

## Desarrollo continuo

```bash
pnpm dev:firefox   # WXT en modo watch
```

## Arquitectura

Ver [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Seguridad

- **No** se solicita el permiso `cookies` ni `<all_urls>` por defecto.
- **No** se envían cuestionarios ni respuestas a terceros.
- Redacción automática antes de cualquier copia o descarga.
- El envío final del intento **nunca** se activa desde la extensión — invariante comprobada por dos spies (`no-submit-spy.ts` para `form.submit()` / `requestSubmit()`; `fetch-spy.ts` para `fetch()` a `processattempt.php` / `finishattempt`).
- Los jobs de autollenado se persisten en `storage.session` (TTL 30 min), nunca en `storage.sync`.
- 4 tests de seguridad corren como gating de merge: `tests/security/{storage-no-sync,host-permissions,redaction-on-output,no-submit-invariant}.spec.ts`.

Política de datos: `data_collection_permissions.required: ["none"]`.

## Estado del proyecto

Fases 0 + 1 + 2 + 3 + 4 merged. **Versión actual: 0.4.0.** Lista
para enviar a Mozilla AMO (ver `docs/AMO-RELEASE.md`).

| PR | Alcance |
|---|---|
| #2 (merged) | Scaffold WXT MV3 + correcciones obligatorias a T15 |
| #4 (merged) | Parser radio/checkbox + detector + content script + no-submit invariant |
| #6 (merged) | Renderer Markdown literal al `prompt.md` + golden files para las 4 fixtures + 8 tests de integración |
| #8 (merged) | Manifest fix: elimina `gecko_android.id` redundante |
| #10 + #12 (merged) | Fase 2: AssetPlanner + ZipPackager + AssetFetchClient + DownloadService + DiagnosticRedactor + popup mínima + CI |
| #14 (merged) | Renderer: `Question.kind` crudo en lugar de etiqueta traducida |
| #16 (merged) | Background usa `tabUrl` para pedir permiso scoped (no `<all_urls>`) |
| #18 (merged) | Fase 3 (1/6): núcleo puro del autofill (parser, apply-plan, job-state, preview-validator, redact, Zod schema) |
| #20 (merged) | Fase 3 (2/6): parsers `short_text` / `long_text` / `select` |
| #22 (merged) | Fase 3 (3/6): `JobStore` (storage.session TTL 30 min) + `PageFetchClient` (concurrency 1) |
| #24 (merged) | Fase 3 (4/6): `fetch-spy` para `processattempt.php` / `finishattempt` |
| #26 (merged) | Fase 3 (5/6): `ControlApplicator` + `PaginationController` |
| #28 (merged) | Fase 3 (6/6): popup 4-tab + flujo autofill completo + tests security |
| #30 (merged) | Documentación Fase 3 (ARCHITECTURE + README + SECURITY inicial) |
| #32–#37 (merged) | Fixes post-3: tabUrl scoped, Cancel tras validar, persistencia popup, keep-state, no redactar JSON propio |
| #38 (merged) | Preflight Fase 4: sincroniza docs stale, cierra issues viejos |
| #40 (merged) | Fase 4.1: diagnóstico seguro (logger + safe report + Zod) |
| #42 (merged) | Fase 4.2: fixture opt-in HTML (sanitizador + redactor + bundle fflate) |
| #44 (merged) | Fase 4.3: hardening OWASP A01-A10 + threat model STRIDE |
| este PR | Fase 4.4: iconos MQX + zip MV3 + excludeSources + workflow release 0.4.0 |

Tests: **391/391** verdes (Fase 0 + 1 + 2 + 3 + 4). `web-ext lint`:
0 errors / 0 notices / 2 warnings (los warnings `DANGEROUS_EVAL`
provienen del bundle de Zod 4.4.3, preexistentes en `main`).
Validación corre en CI (GitHub Actions) en cada PR. El release
workflow corre al pushear tag `v*`.

Política de datos: `data_collection_permissions.required: ["none"]`.
Sin cookies, sin backend, sin telemetría, sin `<all_urls>` por defecto.

## Licencia

Ver [`LICENSE`](LICENSE).
