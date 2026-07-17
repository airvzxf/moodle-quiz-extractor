# Seguridad — moodle-quiz-extractor

> Estado: **Fase 4 (en curso)**. Cubre las decisiones y mitigaciones
> concretas que están en `main`. La matriz OWASP completa (A01–A10) y
> el threat model se completan en la PR 4.3 de Fase 4.

## Principios

1. **Local-first** — sin backend, sin telemetría, sin cookies permission, sin `<all_urls>` por defecto.
2. **DOM no confiable** — todo dato de Moodle se valida y sanitiza antes de salir del content script.
3. **Operaciones reanudables** — la paginación usa jobs idempotentes persistidos en `storage.session` (TTL 30 min), **nunca** `storage.sync`.
4. **Permiso mínimo** — acceso por origen solicitado por acción del usuario; nunca `<all_urls>` por defecto.
5. **Sin envío final automático** — invariante comprobada por spies (`no-submit-spy.ts` + `fetch-spy.ts`).
6. **Redacción doble** — toda cadena que cruza el límite content→background o content→popup pasa por `redactString` (canarios de `src/diagnostics/canary-patterns.ts`).

## Matriz OWASP (resumen Fase 3)

| Categoría | Amenaza | Mitigación | Test gating |
|---|---|---|---|
| **A01 Broken Access Control** | La extensión podría solicitar `<all_urls>` para "facilitar" la descarga de assets. | El content script envía `tabUrl` (`window.location.href`) y el background pide `originPatternFor(tabUrl)` — permiso scoped a la página. `<all_urls>` solo como fallback documentado. | `tests/security/host-permissions.spec.ts` (baseline del manifest) |
| **A03 Injection** | Las respuestas del usuario contienen HTML/script que se inyecta al DOM. | Redacción con `redactString` (canarios: `sesskey`, `MoodleSession`, `attempt`, `cmid`, `name="qNNN:NNN_*"`, hex blobs, email). Fail-closed: `MqxPrivLeakError`. | `tests/security/redaction-on-output.spec.ts` |
| **A04 Insecure Design** | Job state machine con transiciones inválidas que permitan bypass del spy. | State machine pura + matriz exhaustiva (state × event). Spies re-entrantes con refcount. El apply loop nunca llama a `disable()`. | `tests/unit/job-state.spec.ts` (47 casos), `tests/unit/fetch-spy.spec.ts` |
| **A05 Security Misconfiguration** | `storage.sync` accidental que cruza dispositivos. | Static grep en CI: ningún archivo de `src/` puede importar `browser.storage.sync`. `JobStore` solo usa `browser.storage.session`. | `tests/security/storage-no-sync.spec.ts` |
| **A07 Identification & Auth Failures** | Permiso `cookies` para saltarse el sandbox. | El manifest **nunca** declara `cookies`; usa `credentials: 'include'` para reusar la cookie existente. | `tests/security/host-permissions.spec.ts` (prohíbe `'cookies'`) |
| **A08 Software & Data Integrity** | ApplyPlan con fingerprint stale podría rellenar la pregunta equivocada. | `preview-validator` aborta con `MQX-FILL-307` cuando el `stableFingerprint` no está en la página actual o el `kind` cambió. | `tests/unit/preview-validator.spec.ts` |
| **A09 Logging Failures** | Las respuestas quedan en logs. | Solo se loguean códigos; el contenido del usuario se redacta con `redactString` antes de cualquier ruta de salida. | (cubierto por `redaction-on-output.spec.ts`) |
| **A10 SSRF** | `PageFetchClient` recibe una URL manipulada. | La URL siempre viene del content script, validada contra `originPattern`; rechaza cualquier URL fuera del patrón antes de hacer fetch. | `tests/unit/page-fetch-client.spec.ts` |

## Permisos runtime

| Acción del usuario | Permiso necesario | Quién lo pide | Cuándo se concede |
|---|---|---|---|
| Extraer página actual | `activeTab` (ya en manifest) | content script al cargar | Automático al inyectar |
| Descargar ZIP | `pluginfile.php` origin (scoped) | popup → background → `permissions.request({ origins: [<pageOrigin>] })` | Al pulsar "Descargar ZIP" |
| Navegar entre páginas | (ninguno, ya cubierto por `*://*/*mod/quiz/attempt.php*`) | — | — |
| Autollenado | (ninguno adicional) | — | — |
| Reanudar job tras crash | `storage.session` (implícito) | background al crear el job | Al pulsar "Validar" |

**Regla**: el background NUNCA pide permisos por sí solo. Siempre es un re-envío de una intención que el usuario ya expresó en el popup o en la página.

## Tests de seguridad (gating de merge)

| Test | Qué prueba |
|---|---|
| `tests/security/no-submit-invariant.spec.ts` | Para cada fixture redactada, `form.submit()` y `form.requestSubmit()` lanzan `MQX-FILL-304`; `fetch()` POST a `attempt.php?finishattempt|processattempt` lanza `MQX-FILL-305`; los GET nunca bloquean. |
| `tests/security/storage-no-sync.spec.ts` | Ningún archivo de `src/` puede importar `browser.storage.sync` / `storage.sync` / `storage_sync` (comentarios strippeados). |
| `tests/security/redaction-on-output.spec.ts` | Un canario en la entrada del usuario dispara `MqxPrivLeakError` al pasar por `redactParsedAnswers`. La serialización JSON del `ApplyPlan` está libre de canarios. |
| `tests/security/host-permissions.spec.ts` | El manifest declara SOLO el baseline de Fase 2 (`activeTab`, `storage`, `scripting`, `downloads`, el `host_permissions` scoped a `attempt.php`) y `optional_host_permissions: <all_urls>`. Prohíbe añadir `cookies`. |

## Amenazas conocidas y diferidas (Fase 4+)

- **Shuffle between pages**: si un profesor activa "shuffle within question", el orden de las opciones cambia entre páginas. Hoy emitimos `MQX-FILL-307` como warning; la revalidación robusta letra→texto queda como follow-up.
- **Native Messaging / host (`moodlectl.py`)**: difiere a Fase 5. La superficie añadida requiere un protocolo Zod-validado y un canal IPC con scope mínimo.
- **Multi-perfil / incognito**: `storage.session` se degrada a memoria; el popup debe indicarlo al usuario.

## Reporte de vulnerabilidades

Si encuentras una vulnerabilidad de seguridad, por favor **no abras un issue público**. Envía un correo a `israel.alberto.rv@gmail.com` con los detalles (versión, fixture mínima, impacto). Respondo en < 7 días.