# moodle-quiz-extractor — Arquitectura

Esta extensión es **local-first**: nunca envía tus cuestionarios ni respuestas a ningún servidor. Todo el procesamiento (extracción, redacción, empaquetado) ocurre dentro del navegador autenticado.

## Diagrama de capas

```text
┌─────────────────────────── Navegador (Firefox 140+ / Android 142+) ───────────────────────────┐
│                                                                                              │
│  Popup / Opciones                                                                            │
│      │  permisos, configuración, inicio                                                      │
│      ▼                                                                                       │
│  Background coordinator (MV3 service worker)                                                 │
│   ├─ PermissionManager          (origen-allowlist, MV3 dynamic content scripts)              │
│   ├─ PageFetchClient            (GET autenticado, concurrency 1)                             │
│   ├─ AssetFetchClient           (pluginfile.php, MIME allowlist, magic bytes)                │
│   ├─ JobStore                   (storage.session, TTL 30 min, nunca storage.sync)            │
│   ├─ DownloadService            (downloads.download, revoca blob: tras uso)                  │
│   └─ [futuro] NativeMessagingBridge                                                         │
│      │  mensajes tipados (Zod discriminated unions)                                          │
│      ▼                                                                                       │
│  Content script + Shadow DOM panel                                                           │
│   ├─ MoodleAttemptDetector     (RF-1)                                                        │
│   ├─ MoodleDomAdapter          (selectores versionados, parser registry)                     │
│   ├─ QuestionParserRegistry    (radio / checkbox / short_text / long_text / select / unsup)  │
│   ├─ PaginationAutofillController                                                          │
│   └─ NoSubmitSpy               (HTMLFormElement.submit/requestSubmit + processattempt.php)   │
│      │  QuizDocument (modelo intermedio tipado, Zod-validado)                                │
│      ▼                                                                                       │
│  Núcleo puro (testable en Node/jsdom, sin APIs de navegador)                                 │
│   ├─ Schema / validation         (Zod)                                                       │
│   ├─ HTML sanitizer + MarkdownRenderer (DOMPurify + Turndown)                                │
│   ├─ AssetPlanner                (URL, MIME, hash, dedupe, naming)                            │
│   ├─ ZipPackager                 (fflate — NUNCA .tar)                                       │
│   ├─ AnswerListParser            (BNF: 1. a) / 2. c) / 3. a,c / 4. texto libre)              │
│   ├─ DiagnosticRedactor          (doble redacción, MQX-PRIV-401)                             │
│   └─ Logger                      (LogEvent estructurado, ring buffer 200)                    │
│                                                                                              │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Principios arquitectónicos (heredados de T15)

1. **Local-first** — sin backend, sin telemetría, sin cookies permission, sin `<all_urls>` por defecto.
2. **DOM no confiable** — todo dato de Moodle se valida y sanitiza antes de salir del content script.
3. **Adaptadores por capacidad** — radio/checkbox/textarea se detectan por la presencia de controles, con la clase Moodle como señal secundaria.
4. **Modelo intermedio antes de salida** — el HTML nunca se convierte directo a Markdown; primero se normaliza a `QuizDocument` (tipado + Zod).
5. **Operaciones reanudables** — la paginación usa jobs idempotentes persistidos en `storage.session` (TTL 30 min).
6. **Errores explícitos** — un tipo no soportado se exporta con advertencia visible; el autollenado se bloquea para esa pregunta.
7. **Permiso mínimo** — acceso por origen solicitado por acción del usuario; nunca `<all_urls>` por defecto.
8. **Sin envío final automático** — invariante comprobada por spies (no-submit) en `HTMLFormElement.prototype.submit`, `requestSubmit`, y `fetch(...., 'processattempt.php')`.

## Stack (versiones exactas)

| Capa | Paquete | Versión | Por qué |
|---|---|---|---|
| Lenguaje | TypeScript | `5.9.3` | strict + `noUncheckedIndexedAccess` |
| Build | WXT | `0.20.27` | genera MV3 por navegador (Firefox desktop + Android) |
| HTML→MD | Turndown | `7.2.4` | + DOMPurify para sanitizer |
| Sanitizer | DOMPurify | `3.4.12` | obligatorio antes de Markdown |
| Validación | Zod | `4.4.3` | mensajes entre contextos, schema de QuizDocument |
| ZIP | fflate | `0.8.3` | pequeño, MIT, sin .tar() — NUNCA usar `.tar()` |
| TAR (deferred) | tar-stream | `3.2.0` | instalado pero no usado hasta Fase 5 |
| Hash | Web Crypto | built-in | SHA-256 para `stableFingerprint` y assets |
| Test | Vitest | `4.1.10` | + jsdom 29.1.1 |

## Estructura del repositorio

```text
moodle-quiz-extractor/
├── entrypoints/                 # WXT entrypoints
│   ├── background.ts            # coordinator MV3
│   └── content/
│       └── moodle.content.ts    # detector + parser (Fase 1)
├── src/
│   ├── domain/                  # Zod schemas + tipos
│   ├── moodle/                  # detector, dom-adapter, parsers/, applicators/
│   ├── export/                  # markdown.ts, assets.ts, manifest.ts, zip.ts
│   ├── autofill/                # answer-list-parser, validator, apply-plan, job-machine
│   ├── diagnostics/             # logger, redactor, bundle, safe-report
│   ├── permissions/             # origin-allowlist
│   └── messaging/               # Zod-validated runtime messages
├── public/                      # iconos WXT
├── _locales/es/messages.json
├── tests/
│   ├── fixtures/redacted/       # versiones saneadas (generadas por tools/redact-fixture.mjs)
│   ├── unit/                    # parsers, markdown, redactor
│   ├── integration/             # extract end-to-end sobre fixtures
│   └── contracts/               # golden files Markdown
├── tools/
│   ├── redact-fixture.mjs       # redacción-by-construction (minado de baseline-05)
│   ├── inspect-debug.ts         # mqx:inspect
│   └── replay-debug.ts          # mqx:replay
├── docs/
│   ├── ARCHITECTURE.md          # este archivo
│   └── SECURITY.md              # OWASP matrix (Fase 4)
├── wxt.config.ts
├── vitest.config.ts
├── tsconfig.json
├── package.json
└── pnpm-lock.yaml
```

## Fases

| Fase | Alcance | Estado |
|---|---|---|
| 0 | Higiene, privacidad, scaffold WXT MV3, correcciones T15 #3-#5 | merged (PR #2) |
| 1 | Extracción monopágina + Markdown literal al `prompt.md` | merged (PR #4 + #6) |
| 2 | Assets autenticados + ZIP (AssetPlanner, AssetFetchClient, ZipPackager, DownloadService, redactor, manifest, popup, CI) | merged (PR #10 + #12 + #8) |
| 3 | Paginación + autollenado seguro | merged (PR #15–#22) |
| 4 | Diagnóstico two-tier, hardening, release Firefox | en curso (PRs incrementales) |
| 5 | Native Messaging/CLI, Android, Chromium, Configuración | stretch |

## Fase 2 — cambios principales

| Módulo | Rol | Tests |
|---|---|---|
| `src/diagnostics/canary-patterns.ts` | Canarios compartidos entre `tools/redact-fixture.mjs` y `src/diagnostics/redactor.ts` | 10 |
| `src/diagnostics/redactor.ts` | Doble redacción runtime (MQX-PRIV-401) | 14 |
| `src/export/asset-planner.ts` | Planificador puro (dedupe, MIME, magic bytes, naming estable) | 19 |
| `src/export/manifest.ts` + `src/domain/manifest-schema.ts` | Sidecar `manifest.json` con provenancia + asset list + warnings | cubiertos por integration |
| `src/export/zip.ts` | `fflate.zipSync`, redactor aplicado a markdown y JSON, escape de `..`/`/` | 7 |
| `src/background/asset-fetch-client.ts` | GET autenticado (cookies de sesión), MIME allowlist, magic bytes, timeout, redirect-to-login detection, concurrency cap | cubierto por integration |
| `src/background/download-service.ts` | `browser.downloads.download` + revoke `blob:` URL | cubierto por integration |
| `src/background/zip-orchestrator.ts` | Pipeline end-to-end | cubierto por integration |
| `src/permissions/asset-permissions.ts` | `permissions.contains` + `permissions.request` opt-in | cubierto por unit |
| `src/messaging/runtime-messages.ts` | Contrato Zod entre content / background / popup | cubierto por integration |
| `src/entrypoints/popup.{html,ts}` | UI mínima accionable | manual (no testable en jsdom) |
| `tests/integration/zip-pipeline.spec.ts` | Pipeline end-to-end sobre dsop-02 con stub fetch + doble redacción | 3 |
| `.github/workflows/ci.yml` | CI en PR (compile + test + build:firefox + lint:ext + redact) | workflow |

Permisos runtime: la Fase 2 mantiene la política deny-by-default. El
manifest MV3 declara `host_permissions: ['*://*/*mod/quiz/attempt.php*']`
y `optional_host_permissions: ['<all_urls>']`. La descarga autenticada de
`pluginfile.php` se concede **sólo cuando el usuario pulsa "Descargar ZIP"
en el popup**, vía `browser.permissions.request({ origins: [<pageOrigin>]/* })`,
no se concede `<all_urls>` globalmente.

## Fase 3 — cambios principales

| Módulo | Rol | Tests |
|---|---|---|
| `src/autofill/answer-list-parser.ts` | Parser BNF puro del formato del README (`1. a)` / `2. a,c` / `3. texto`). Desambigua listas de letras de prosa natural. | 29 |
| `src/autofill/apply-plan.ts` | `buildApplyPlan(answers, doc)`: strict (`unsupported` → abort, letras inexistentes → abort, duplicados → last-write-wins). | 13 |
| `src/autofill/job-state.ts` | State machine pura (`idle → validating → previewing → applying → done | aborted | failed`) con `TransitionError` exhaustivo y matriz (state × event). | 47 |
| `src/autofill/preview-validator.ts` | Revalida el plan contra `QuizDocument` actual tras la paginación. Faltas → `MQX-FILL-307`. | 5 |
| `src/autofill/redact-answers.ts` | Wrapper de `redactString` por campo. Fail-closed ante canarios. | 3 |
| `src/domain/apply-plan-schema.ts` | Zod schemas del `ApplyPlan` (consumido por `runtime-messages`). | cubierto por integration |
| `src/moodle/parsers/short-text.ts` | Parser para `<input type=text>`. | 4 |
| `src/moodle/parsers/long-text.ts` | Parser para `<textarea>`. | 3 |
| `src/moodle/parsers/select.ts` | Parser para `<select>` (letras desde prefijo del texto o sintéticas). | 4 |
| `src/moodle/parsers/registry.ts` | Despacha a los nuevos parsers antes del fallback `unsupported`. | 4 (en parsers.spec.ts) |
| `src/background/job-store.ts` | Persistencia en `browser.storage.session` (TTL 30 min) con adaptadores mockeables. | 12 |
| `src/background/page-fetch-client.ts` | GET autenticado con concurrencia 1 (semáforo), detecta redirect a `/login/`. | 9 |
| `src/moodle/applicators/no-submit-spy.ts` | Refactor: `uninstall()` restaura `submit` / `requestSubmit` a no-ops. | (tests existentes) |
| `src/moodle/applicators/fetch-spy.ts` | Cierra el último hueco de "no envío final" interceptando `fetch()` a `attempt.php?finishattempt|processattempt`. | 11 |
| `src/moodle/applicators/control-applicator.ts` | `applyStep` con 5 mutadores (radio / checkbox / short_text / long_text / select). Setter nativo para que Moodle vea un input de usuario real. | 10 |
| `src/moodle/pagination-controller.ts` | `clickNextPage`: clic sintético sobre `a.qnbutton[data-quiz-page=N]`. Preserva CSRF/referer/eventos de Moodle. | 5 |
| `src/messaging/runtime-messages.ts` | +6 schemas Zod (`prepareAutofill`, `applyAutofill`, `abortAutofill`, `getAutofillJob`, …). Retro-compatibles. | cubierto por integration |
| `src/entrypoints/content.ts` | Handlers `prepareAutofill` / `applyAutofill` / `abortAutofill` / `getAutofillJob`. Instala ambos spies durante `applyAutofill`. | cubierto por integration |
| `src/entrypoints/popup.html` + `src/popup/main.ts` | 4 pestañas (Extraer / Autocompletar / Diagnóstico / Configuración); tab "Autocompletar" con textarea + Validar / Aplicar / Cancelar. | manual |
| `tests/security/storage-no-sync.spec.ts` | Static grep: ningún archivo de `src/` puede importar `storage.sync`. | 2 |
| `tests/security/host-permissions.spec.ts` | Static check: el manifest declara solo el baseline de Fase 2 (sin `cookies`). | 4 |
| `tests/security/redaction-on-output.spec.ts` | Canarios en la entrada del usuario disparan `MqxPrivLeakError` en `redactParsedAnswers`. | 4 |
| `tests/security/no-submit-invariant.spec.ts` | Para cada fixture redactada: form-spy lanza `MQX-FILL-304`, fetch-spy lanza `MQX-FILL-305` en POST. | 11 |

**Taxonomía extendida** (`src/diagnostics/codes.ts`):
- `MQX-FILL-305` — fetch a `processattempt.php`/`finishattempt` bloqueado por el spy.
- `MQX-FILL-306` — `JobStore` caduca durante `applying`.
- `MQX-FILL-307` — `stableFingerprint` no coincide entre extracción y aplicación.
- `MQX-FILL-308` — pregunta `unsupported` en el `ApplyPlan` (política estricta).
- `MQX-FILL-309` — post-condición del control no confirmada.
- `MQX-PAGE-005` — layout no reconocido durante paginación.
- `MQX-PAGE-006` — Moodle saltó una página / sesión caducada.

**Seguridad (OWASP)**:
- **A01 Broken Access Control**: sigue deny-by-default. El content script envía `tabUrl`; el background usa `originPatternFor(tabUrl)` para pedir permiso scoped (PR #15). Tests `host-permissions.spec.ts` bloquean adiciones.
- **A03 Injection**: respuestas del usuario sanitizadas con `redactString` antes de salir del content script (`tests/security/redaction-on-output.spec.ts`).
- **A04 Insecure Design**: state machine pura + tests tabulares exhaustivos; spies re-entrantes con refcount (`job-state.spec.ts`, `fetch-spy.spec.ts`).
- **A05 Security Misconfiguration**: `tests/security/storage-no-sync.spec.ts` impide `storage.sync`.
- **A07 Identification & Auth Failures**: sin permiso `cookies`; `credentials: 'include'` reutiliza la cookie de sesión existente.
- **A08 Software & Data Integrity**: fingerprint validation previene aplicación de plan stale (`MQX-FILL-307`).
- **A09 Logging Failures**: el contenido del usuario nunca se loguea, solo códigos.
- **A10 SSRF**: `PageFetchClient` rechaza URLs fuera del `originPattern` antes de hacer la petición.

## Decisiones de origen

| Decisión | Origen | Documento |
|---|---|---|
| Arquitectura global, parser registry (6 tipos), `stableFingerprint`, códigos `MQX-*`, máquina de estados, no-submit invariant | T15 | `out/iter-1/01-propuesta-minimax-T15.md` |
| OWASP A01-A10 matrix, deny-by-default URL allowlist, double-redaction, canary tests en CI | security-first | `out/iter-1/01-propuesta-minimax-security-first.md` |
| Renderer skeleton (`renderQuiz` / `renderQuestion` / `renderAnswers` / `formatMeta`) | T05 | `out/iter-1/01-propuesta-minimax-T05.md` líneas 279-329 |
| `tools/redact-fixture.mjs`, workspace tab, `ApplyPlan` preview, Zod-validated messages | baseline-05 | `out/iter-1/01-propuesta-minimax-baseline-05.md` |
| `quiz-<slug>-debug.zip`, multi-letter autofill regex, segundo pass de secretos | baseline-03 | `out/iter-1/01-propuesta-minimax-baseline-03.md` |
| Two-tier diagnostics ("safe report" default / "fixture" opt-in con preview) | baseline-08 | `out/iter-1/01-propuesta-minimax-baseline-08.md` |
