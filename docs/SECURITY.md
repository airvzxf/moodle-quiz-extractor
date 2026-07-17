# Seguridad — moodle-quiz-extractor

> Estado: **Fase 4 (hardening)**. Cubre las decisiones y mitigaciones
> concretas que están en `main`. La matriz OWASP completa (A01–A10) y
> el threat model están completos a partir de PR #43.

## Principios

1. **Local-first** — sin backend, sin telemetría, sin cookies permission, sin `<all_urls>` por defecto.
2. **DOM no confiable** — todo dato de Moodle se valida y sanitiza antes de salir del content script.
3. **Operaciones reanudables** — la paginación usa jobs idempotentes persistidos en `storage.session` (TTL 30 min), **nunca** `storage.sync`.
4. **Permiso mínimo** — acceso por origen solicitado por acción del usuario; nunca `<all_urls>` por defecto.
5. **Sin envío final automático** — invariante comprobada por spies (`no-submit-spy.ts` + `fetch-spy.ts`).
6. **Redacción doble** — toda cadena que cruza el límite content→background o content→popup pasa por `redactString` (canarios de `src/diagnostics/canary-patterns.ts`).
7. **Diagnóstico two-tier** — safe report (códigos agregados, sin contenido del usuario) + fixture opt-in con preview y consentimiento explícito.

## Matriz OWASP (Fase 4 hardening)

| Categoría | Amenaza | Mitigación | Test gating |
|---|---|---|---|
| **A01 Broken Access Control** | La extensión podría solicitar `<all_urls>` para "facilitar" la descarga de assets. | El content script envía `tabUrl` (`window.location.href`) y el background pide `originPatternFor(tabUrl)` — permiso scoped a la página. `<all_urls>` solo como fallback documentado. | `tests/security/host-permissions.spec.ts` (baseline del manifest) |
| **A02 Cryptographic Failures** | Almacenamiento o transporte de secretos sin cifrar. | SHA-256 se usa solo para fingerprinting (no cifrado). `storage.session` vive en el sandbox del perfil del usuario; nunca cruza dispositivos. Sin backend, sin transporte remoto. No se añade cifrado adicional porque no hay canal de red. | `tests/unit/diagnostics-types.spec.ts` (`SafeReportSchema` rechaza campos sensibles), `tests/security/diagnostics-redaction.spec.ts` |
| **A03 Injection** | Las respuestas del usuario contienen HTML/script que se inyecta al DOM. | Redacción con `redactString` (canarios: `sesskey`, `MoodleSession`, `attempt`, `cmid`, `name="qNNN:NNN_*"`, hex blobs, email). Fail-closed: `MqxPrivLeakError`. DOMPurify + sanitizer antes de Markdown. | `tests/security/redaction-on-output.spec.ts`, `tests/security/fixture-leak.spec.ts` |
| **A04 Insecure Design** | Job state machine con transiciones inválidas que permitan bypass del spy. | State machine pura + matriz exhaustiva (state × event). Spies re-entrantes con refcount. El apply loop nunca llama a `disable()`. | `tests/unit/job-state.spec.ts`, `tests/unit/fetch-spy.spec.ts`, `tests/unit/preview-validator.spec.ts` |
| **A05 Security Misconfiguration** | `storage.sync` accidental que cruza dispositivos. | Static grep en CI: ningún archivo de `src/` puede importar `browser.storage.sync`. `JobStore` y `DiagnosticsStore` solo usan `browser.storage.session`. | `tests/security/storage-no-sync.spec.ts` |
| **A06 Vulnerable Components** | Dependencias con CVE. | Lockfile pinneado (`pnpm-lock.yaml`). Inventario congelado (DOMPurify 3.4.12, fflate 0.8.3, Zod 4.4.3, Turndown 7.2.4). `web-ext lint` reporta 2 warnings `DANGEROUS_EVAL` preexistentes (Zod feature detection) — documentado, sin acción en Fase 4. Renovate/Dependabot → Fase 5. | `pnpm audit`, `pnpm lint:ext` (CI gating) |
| **A07 Identification & Auth Failures** | Permiso `cookies` para saltarse el sandbox. | El manifest **nunca** declara `cookies`; usa `credentials: 'include'` para reusar la cookie existente. | `tests/security/host-permissions.spec.ts` (prohíbe `'cookies'`) |
| **A08 Software & Data Integrity** | ApplyPlan con fingerprint stale podría rellenar la pregunta equivocada. | `preview-validator` aborta con `MQX-FILL-307` cuando el `stableFingerprint` no está en la página actual o el `kind` cambió. | `tests/unit/preview-validator.spec.ts` |
| **A09 Logging Failures** | Las respuestas quedan en logs. | Solo se loguean códigos; el contenido del usuario se redacta con `redactString` antes de cualquier ruta de salida. El safe report NO contiene timestamps, tabId, originHash ni título. | `tests/unit/safe-report.spec.ts`, `tests/security/diagnostics-redaction.spec.ts` |
| **A10 SSRF** | `PageFetchClient` recibe una URL manipulada. | La URL siempre viene del content script, validada contra `originPattern`; rechaza cualquier URL fuera del patrón antes de hacer fetch. La fixture HTML reemplaza URLs por `__REDACTED__`. | `tests/unit/page-fetch-client.spec.ts`, `tests/unit/fixture-sanitizer.spec.ts` |

## Permisos runtime

| Acción del usuario | Permiso necesario | Quién lo pide | Cuándo se concede |
|---|---|---|---|
| Extraer página actual | `activeTab` (ya en manifest) | content script al cargar | Automático al inyectar |
| Descargar ZIP | `pluginfile.php` origin (scoped) | popup → background → `permissions.request({ origins: [<pageOrigin>] })` | Al pulsar "Descargar ZIP" |
| Navegar entre páginas | (ninguno, ya cubierto por `*://*/*mod/quiz/attempt.php*`) | — | — |
| Autollenado | (ninguno adicional) | — | — |
| Reanudar job tras crash | `storage.session` (implícito) | background al crear el job | Al pulsar "Validar" |
| Diagnóstico | (ninguno adicional) | — | — |
| Descargar bundle de fixture | (ninguno adicional) | — | — |

**Regla**: el background NUNCA pide permisos por sí solo. Siempre es un re-envío de una intención que el usuario ya expresó en el popup o en la página.

## Diagnóstico two-tier (Fase 4)

| Tier | Contenido | Activación | Privacidad |
|---|---|---|---|
| **Safe report** | Conteos agregados por stage + códigos `MQX-*`; sin timestamp, tabId, originHash, título, URL ni contenido del usuario. | Botón "Ver reporte (safe, local)" en popup | Solo se renderiza dentro del popup; nunca cruza la frontera del navegador. |
| **Fixture HTML redactada** | Snapshot sanitizado (allowlist estructural) + redacción doble + safe report. | Botón "Previsualizar fixture" → consentimiento explícito → "Descargar bundle (ZIP local)" | Antes de cada byte que sale del navegador: canary gate, size cap 5 MiB, nombre determinista derivado del contenido. |

## Threat model (STRIDE)

### Activos

| Activo | Confianza | Ubicación |
|---|---|---|
| Código de la extensión | Alta | Repo + bundle MV3 firmado por AMO |
| DOM de Moodle | NO confiable | Página web |
| Cookies de sesión | Del usuario | Perfil Firefox del usuario |
| Respuestas del usuario (textarea) | Sensible | `storage.session` (TTL 30 min) + popup efímero |
| `storage.session` | Persistencia baja (30 min, per-ventana) | Sandbox del perfil |
| ZIP descargado | Del usuario | Disco local |
| Bundle de fixture descargado | Del usuario | Disco local |

### STRIDE

| Categoría | Amenaza | Mitigación |
|---|---|---|
| **S Spoofing** | Content script malicioso que simula un `sender.tab` con tabId falso. | El background siempre lee `sender.tab.id` del runtime; nunca confía en `tabId` del payload. |
| **T Tampering** | Respuesta del usuario con canario o HTML inyectado. | Redacción doble (`redactString` + `redactFixtureHtml`) en TODA ruta de salida. Safe report `.strict()` Zod rechaza campos extra. |
| **R Repudiation** | El usuario no puede demostrar qué se descargó. | Safe report incluye `generatorVersion`, `manifestVersion` y `exportedAt` ISO-8601; el bundle incluye `safe-report.json` con la misma metadata. |
| **I Information Disclosure** | Logs, ZIP, o bundle revelan contenido del cuestionario. | Safe report **solo** contiene códigos. ZIP redactor-applied. Bundle con allowlist estructural + canary gate + size cap 5 MiB. `storage.session` (no `local`, no `sync`). |
| **D Denial of Service** | Storage quota agotada. | Cada `JobStore`/`PopupSessionStore`/`DiagnosticsStore` degrada a memoria si `storage.session` falla. El logger reporta `dropped` en overflow. |
| **E Elevation of Privilege** | Content script pide `<all_urls>` o `cookies`. | `tests/security/host-permissions.spec.ts` lo prohíbe por static check del manifest. |

## Tests de seguridad (gating de merge)

| Test | Qué prueba |
|---|---|
| `tests/security/no-submit-invariant.spec.ts` | Para cada fixture redactada, `form.submit()` y `form.requestSubmit()` lanzan `MQX-FILL-304`; `fetch()` POST a `attempt.php?finishattempt|processattempt` lanza `MQX-FILL-305`; los GET nunca bloquean. |
| `tests/security/storage-no-sync.spec.ts` | Ningún archivo de `src/` puede importar `browser.storage.sync` / `storage.sync` / `storage_sync` (comentarios strippeados). |
| `tests/security/redaction-on-output.spec.ts` | Un canario en la entrada del usuario dispara `MqxPrivLeakError` al pasar por `redactParsedAnswers`. La serialización JSON del `ApplyPlan` está libre de canarios. |
| `tests/security/host-permissions.spec.ts` | El manifest declara SOLO el baseline de Fase 2 (`activeTab`, `storage`, `scripting`, `downloads`, el `host_permissions` scoped a `attempt.php`) y `optional_host_permissions: <all_urls>`. Prohíbe añadir `cookies`. |
| `tests/security/diagnostics-redaction.spec.ts` | Safe report serializado no contiene canarios ni con campos extra. |
| `tests/security/fixture-leak.spec.ts` | Bundle HTML sanitizado no contiene canarios aunque el input sea hostil (srcdoc, CSS url(), data-* sensibles). |
| `tests/security/fixture-size.spec.ts` | Bundle >5 MiB → `FixtureBundleError`. |
| `tests/security/hardening-tiers.spec.ts` | Eventos hostiles rechazados por Zod strict; iframe srcdoc / CSS url / data-* sensibles / safe report todo limpio de canarios. |

## Amenazas conocidas y diferidas (Fase 5+)

- **Android**: `wxt.config.ts` declara `gecko_android.strict_min_version: '142.0'`, pero el `DownloadService` usa `saveAs: true` que Firefox Android rechaza. Fase 5 hará un branch del download por plataforma.
- **Chromium / Safari / iOS**: stretch. Manifest ya usa claves MV3 portales; el grueso del trabajo es ports de `cookies` y `host_permissions`.
- **Native Messaging / host (`moodlectl.py`)**: difiere a Fase 5. La superficie añadida requiere un protocolo Zod-validado y un canal IPC con scope mínimo.
- **Multi-perfil / incognito**: `incognito: 'not_allowed'` ya está declarado. Privacidad por defecto. El popup podría advertir si `storage.session` se degrada.
- **Shuffle between pages**: hoy emite `MQX-FILL-307` como warning. La revalidación robusta letra→texto queda como follow-up de Fase 5.
- **Renovación de subkey GPG**: el agente actual no puede firmar nuevos commits porque la subkey de firmado está vencida. La CI **no** requiere firma GPG; el resto del gauntlet sigue bloqueante.

## Reporte de vulnerabilidades

Si encuentras una vulnerabilidad de seguridad, por favor **no abras un issue público**. Envía un correo a `israel.alberto.rv@gmail.com` con los detalles (versión, fixture mínima, impacto). Respondo en < 7 días.