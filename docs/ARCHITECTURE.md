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
| 0 | Higiene, privacidad, scaffold WXT MV3, correcciones T15 #3-#5 | **PR #1 (esta)** |
| 1 | Extracción monopágina + Markdown literal al `prompt.md` | PR #2 + #3 (esta sesión) |
| 2 | Assets autenticados + ZIP | futuro |
| 3 | Paginación + autollenado seguro | futuro |
| 4 | Diagnóstico two-tier, hardening, release Firefox | futuro |
| 5 | Native Messaging/CLI, Android, Chromium | stretch |

## Decisiones de origen

| Decisión | Origen | Documento |
|---|---|---|
| Arquitectura global, parser registry (6 tipos), `stableFingerprint`, códigos `MQX-*`, máquina de estados, no-submit invariant | T15 | `out/iter-1/01-propuesta-minimax-T15.md` |
| OWASP A01-A10 matrix, deny-by-default URL allowlist, double-redaction, canary tests en CI | security-first | `out/iter-1/01-propuesta-minimax-security-first.md` |
| Renderer skeleton (`renderQuiz` / `renderQuestion` / `renderAnswers` / `formatMeta`) | T05 | `out/iter-1/01-propuesta-minimax-T05.md` líneas 279-329 |
| `tools/redact-fixture.mjs`, workspace tab, `ApplyPlan` preview, Zod-validated messages | baseline-05 | `out/iter-1/01-propuesta-minimax-baseline-05.md` |
| `quiz-<slug>-debug.zip`, multi-letter autofill regex, segundo pass de secretos | baseline-03 | `out/iter-1/01-propuesta-minimax-baseline-03.md` |
| Two-tier diagnostics ("safe report" default / "fixture" opt-in con preview) | baseline-08 | `out/iter-1/01-propuesta-minimax-baseline-08.md` |
