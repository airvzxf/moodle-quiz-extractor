# Smoke test manual — Fase 3 (v0.3.0)

> Guía paso a paso para validar manualmente que el autollenado seguro, la
> paginación y los spies funcionan como esperan los tests automatizados.
>
> Requisitos: Firefox 140+ (o 142+ en Android), Node 20.19+, pnpm 10.13+,
> y una cuenta de Moodle con un cuestionario real (o uno de prueba).

---

## 0. Preparación

```bash
# desde la raíz del repo
pnpm install --frozen-lockfile
pnpm prepare
pnpm test             # debe imprimir 306/306 verde
pnpm compile         # type-check
pnpm build:firefox    # produce .output/firefox-mv3/
```

Abre Firefox y carga la extensión:

1. Visita `about:debugging#/runtime/this-firefox`.
2. **Cargar complemento temporal…** → selecciona `.output/firefox-mv3/manifest.json`.
3. Abre la consola del navegador (`Ctrl-Shift-J`) — busca el log
   `[moodle-quiz-extractor] background started`.

---

## 1. Pestaña "Extraer" (smoke del flujo Fase 2)

### 1.1 Detección básica

1. Inicia sesión en Moodle y entra a un intento de cuestionario
   (`/mod/quiz/attempt.php?attempt=…`).
2. Haz clic en el icono de la extensión en la barra de herramientas.
3. En el popup, deja la pestaña **Extraer** activa (es la primera).
4. Pulsa **Extraer página actual**.

**Esperado**:
- Status: `Detectado: <título> — <N> pregunta(s).` (data-state="ok", fondo verde).
- Botón **Descargar ZIP** se habilita.
- En la consola del content script (DevTools de la pestaña de Moodle, no del popup):
  ningún error.

### 1.2 Descarga del ZIP

1. Pulsa **Descargar ZIP**.
2. Firefox muestra un prompt: *"Permitir que la extensión acceda a
   los datos del sitio https://moodle.<tu-instancia>.edu"*.

**Esperado**:
- El prompt pide permiso **solo para el origen de Moodle** (no `<all_urls>`).
- Tras aceptar, status: `ZIP listo: quiz-<slug>.zip (X/Y imágenes, Z con error).`
- El ZIP baja y se abre: contiene `quiz.md`, `quiz.json`,
  `manifest.json`, y `quiz/<imágenes>`.

### 1.3 Redacción de secretos en el ZIP

1. Abre `manifest.json` del ZIP descargado con un editor de texto.
2. `Ctrl-F` para buscar: `sesskey`, `MoodleSession`, `attempt=NNN`,
   `cmid=NNN`, `name="qNNN:NNN_`.

**Esperado**: ninguno de esos tokens aparece (todos están como
`__REDACTED__` o han sido eliminados).

### 1.4 Smoke negativo

1. Abre una pestaña en `https://example.com/` (no es Moodle).
2. Pulsa **Extraer página actual**.

**Esperado**: status de error — `Esta pestaña no parece un intento de
cuestionario Moodle.` (data-state="error", fondo rojo).

---

## 2. Pestaña "Autocompletar" (smoke del flujo Fase 3)

### 2.1 Detección + validación (camino feliz)

1. Vuelve a la pestaña del intento de cuestionario.
2. En el popup, haz clic en la pestaña **Autocompletar**.
3. Pega esta lista en el textarea (ajusta el número de pregunta al tuyo):

```text
1. a)
2. c)
3. a,c
4. d)
```

4. Pulsa **Validar respuestas**.

**Esperado**:
- Status cambia a `Validando respuestas…` y luego a
  `OK: <N> pasos listos. Pulsa "Aplicar respuestas".` (verde).
- Botón **Aplicar respuestas** se habilita.
- Botón **Cancelar** se habilita.

### 2.2 Aplicación (radio + checkbox)

1. Pulsa **Aplicar respuestas**.
2. Mira la pestaña del intento de Moodle (no el popup).

**Esperado**:
- Los radios / checkboxes de las preguntas 1-4 quedan marcados con
  las letras correctas.
- El popup muestra `Listo: <applied>/<total> controles aplicados.
  Revisa y envía manualmente.`
- En la consola del content script, ningún error.

### 2.3 Invariante "no envío final" (spies)

1. Sin recargar la página, abre DevTools de la pestaña Moodle
   (`F12`) y ve a la consola.
2. Ejecuta:

```js
document.getElementById('responseform').submit();
```

**Esperado**: `Error: MQX-FILL-304: submit blocked by no-submit invariant`.

3. Ejecuta:

```js
fetch('/mod/quiz/attempt.php?finishattempt=1', { method: 'POST' });
```

**Esperado**: `Error: MQX-FILL-305: submit blocked by fetch-spy invariant`.

4. Ejecuta la misma con GET:

```js
fetch('/mod/quiz/attempt.php?finishattempt=1');
```

**Esperado**: pasa a la red (puede que devuelva un 200 con HTML de la
misma página, pero **no lanza**).

### 2.4 Cancelar un job a medias

1. Aplica un job (sección 2.2).
2. Antes de enviar manualmente, abre el popup y pulsa **Cancelar**.

**Esperado**:
- Status: `Cancelado.`
- Los radios / checkboxes marcados permanecen marcados (cancelar
  no "deshace" — eso es responsabilidad del usuario).
- Los spies se desinstalaron (intenta de nuevo `form.submit()`:
  ya NO lanza `MQX-FILL-304`; el form vuelve a su comportamiento
  nativo).

### 2.5 Smoke negativo: letra inexistente

1. Pega:

```text
1. z)
```

2. Pulsa **Validar respuestas**.

**Esperado**: status de error — `Errores: MQX-FILL-301: pregunta 1:
letra(s) no disponible(s): z` (texto rojo, fondo rojo).
Botón **Aplicar respuestas** queda deshabilitado.

### 2.6 Smoke negativo: número fuera de rango

1. Pega:

```text
99. a)
```

2. **Validar respuestas**.

**Esperado**: error `MQX-PARSE-103: pregunta 99: no existe en el
cuestionario extraído`.

### 2.7 Smoke negativo: `unsupported` estricto

1. Si tu cuestionario tiene una pregunta `select` / `textarea` / texto
   que el parser reconozca pero la lista apunte a una pregunta `unsupported`,
   pega la línea correspondiente.

**Esperado**: error `MQX-FILL-308: tipo no soportado por el autollenado
(resuelve a mano)`. La política estricta aborta el job completo.

### 2.8 Canario en la entrada del usuario

1. Pega:

```text
1. sesskey=leaked123abc
```

2. **Validar respuestas**.

**Esperado**: el content script redacta antes de parsear. Si
redactar dispara, el popup ve un error genérico; si no, el plan se
construye con `sesskey=leaked123abc` como "texto libre" y la letra
NO existe → `MQX-FILL-301`. En cualquier caso, **la cadena `sesskey=leaked`
no debe llegar al `ApplyPlan` persistido** (puedes verificarlo
abriendo DevTools → Application → Storage → Extension Storage →
`mqx:job:<uuid>` → el campo `value` no contiene `sesskey=leaked`).

---

## 3. Paginación (smoke)

### 3.1 Cuestionario multipágina

1. Entra a un cuestionario que tenga 2+ páginas (los botones
   `Página 1`, `Página 2`, … aparecen abajo).
2. Pestaña **Extraer**: pulsa **Extraer página actual** (sólo extrae la
   página visible, que es el comportamiento esperado de Fase 1-2).
3. Cambia a la pestaña **Autocompletar**.
4. Pega una lista con respuestas para preguntas de la página 1.

**Esperado**:
- La validación funciona para las preguntas de la página 1.
- Para preguntas de páginas siguientes: la validación emite
  `MQX-FILL-307: no se encuentra en la página actual` (es una
  advertencia, no un fallo — el job puede continuar con las que sí
  estén).

> **Nota**: la paginación automática (clic sintético sobre
> `a.qnbutton` entre páginas) está cableada pero el popup actual
> sólo aplica a la página visible. La navegación sintética se
> dispara desde `src/moodle/pagination-controller.ts` (probada con
> tests en `tests/unit/pagination-controller.spec.ts`).

### 3.2 Test directo del controlador de paginación

En la consola de DevTools de Moodle:

```js
const a = document.querySelector('a.qnbutton[data-quiz-page="2"]');
if (a) { console.log('next-page anchor found:', a.href); }
```

**Esperado**: imprime la URL de la siguiente página. Si tu
cuestionario sólo tiene una página, imprime `null` (sin error).

---

## 4. Spies en la consola (smoke rápido sin popup)

Si quieres verificar los spies sin pasar por el popup:

```js
// Pega en la consola de la pestaña del intento
// (sólo mientras un job está activo)
document.getElementById('responseform').submit();
// → Error: MQX-FILL-304: submit blocked by no-submit invariant

fetch('/mod/quiz/attempt.php?finishattempt=1', { method: 'POST' });
// → Error: MQX-FILL-305: submit blocked by fetch-spy invariant

// GET pasa
await fetch('/mod/quiz/attempt.php?finishattempt=1').then(r => r.status);
// → 200
```

---

## 5. Persistencia (JobStore)

El job se guarda en `storage.session` mientras el job esté activo. Para
verificar:

1. DevTools → Application → Storage → **Extension Storage** (no
   `chrome.storage.session` directamente — WXT lo expone bajo el
   namespace `extension`).
2. Filtra por `mqx:job:`.

**Esperado**: una entrada con la clave `mqx:job:<uuid>`. Su valor es:

```json
{
  "value": {
    "jobId": "<uuid>",
    "state": "applying",
    "plan": { "schemaVersion": "1.0", "steps": [...], "warnings": [] },
    "updatedAt": 1752000000000
  }
}
```

Tras 30 minutos sin heartbeat, la entrada se purga en el próximo `load()`.

**Para forzar la expiración**: edita manualmente `updatedAt` a un valor
muy antiguo, cierra y reabre la pestaña, y observa que `getAutofillJob`
devuelve `found: false`.

---

## 6. Permisos del manifest (smoke)

Abre `about:debugging#/runtime/this-firefox` → la extensión cargada →
**Permisos** / **Permissions**.

**Esperado**:
- **Permissions**: `activeTab`, `storage`, `scripting`, `downloads`.
- **Host permissions**: `*://*/*mod/quiz/attempt.php*`.
- **Optional host permissions**: `<all_urls>` (sólo se concede cuando
  tú lo apruebas; el popup NO lo pide por defecto).

Si ves `cookies`, hay un bug — repórtalo.

---

## 7. Lint y build

```bash
pnpm lint:ext
```

**Esperado**: 0 errors / 0 notices / 2 warnings (`DANGEROUS_EVAL` en el
output bundleado de Turndown y DOMPurify — preexistentes en `main`).

---

## 8. Redacción de fixtures

```bash
pnpm redact
```

**Esperado**:

```
✓ ddoo-01-page-01.html (212026 → 210397 bytes)
✓ ddoo-02-page-01.html (212574 → 210949 bytes)
✓ dsop-01-page-01.html (239983 → 237693 bytes)
✓ dsop-02-page-01.html (244304 → 241958 bytes)
Done: 4 fixture(s) verified, 0 blocked.
```

Si alguna dice `redaction FAILED, <N> canary pattern(s) still present`,
un secreto sobrevivió — repórtalo.

---

## 9. Resumen de la matriz de smoke tests

| # | Acción | Esperado | Cubre |
|---|---|---|---|
| 1.1 | Extraer página actual | `OK` con N preguntas | Fase 1-2 |
| 1.2 | Descargar ZIP | Prompt de permiso **scoped** (no `<all_urls>`) | PR #15 |
| 1.3 | Inspeccionar `manifest.json` del ZIP | Sin canarios | Fase 2 |
| 1.4 | Extraer en pestaña no-Moodle | Error rojo | Detector |
| 2.1 | Validar respuestas (camino feliz) | `OK: N pasos` | PR #18 |
| 2.2 | Aplicar respuestas | Controles marcados, status verde | PR #26 |
| 2.3 | `form.submit()` en consola | `MQX-FILL-304` | PR #19 + spies |
| 2.3 | `fetch(POST attempt.php)` | `MQX-FILL-305` | PR #24 |
| 2.3 | `fetch(GET attempt.php)` | Pasa | (pass-through intencional) |
| 2.4 | Cancelar job | Spies desinstalados | `handleAbort` |
| 2.5 | Letra inexistente | `MQX-FILL-301` | apply-plan |
| 2.6 | Número fuera de rango | `MQX-PARSE-103` | apply-plan |
| 2.7 | Pregunta `unsupported` | `MQX-FILL-308` (aborto) | apply-plan strict |
| 2.8 | Canario en input | Canario redactado / `MQX-FILL-301` | redaction |
| 3.1 | Paginación multipágina | Validación page-by-page | PR #26 |
| 5 | JobStore | Entrada `mqx:job:<uuid>` | PR #22 |
| 6 | Permisos manifest | Lista correcta, sin `cookies` | PR #15 + gating |
| 7 | `pnpm lint:ext` | 0/0/2 (warnings preexistentes) | — |
| 8 | `pnpm redact` | 4 fixtures verified, 0 blocked | — |

---

## 10. Troubleshooting

| Síntoma | Causa probable | Remedio |
|---|---|---|
| El popup dice `Esta pestaña no parece un intento de cuestionario Moodle.` | No estás en `/mod/quiz/attempt.php?attempt=…` | Navega al intento real |
| El prompt de permiso pide `<all_urls>` | Bug en `requestAssetPermission` — el `tabUrl` no llegó al background | Recarga la pestaña del intento y vuelve a pulsar Descargar ZIP; revisa la consola del background |
| `MQX-FILL-302: control no confirmó` | Moodle tiene JS que sobrescribe el setter nativo | Reportar issue con la URL y la fixture; workaround: usar la consola para asignar manualmente |
| El ZIP baja pero no tiene imágenes | El servidor Moodle requiere cookies que el SW no envía | Verificar que la sesión está activa en otra pestaña de la misma ventana |
| El job expira a los pocos segundos | El `setTimeout` del JobStore está desincronizado | Recargar la pestaña; el TTL real es 30 min |
| `pnpm test` falla con `storage.sync references found` | Alguien añadió `storage.sync` | Quitar la referencia (los comentarios con la palabra `storage.sync` se strippean antes del grep, no son un hit) |

---

## 11. Después del smoke

Si todo lo anterior pasa:

- **Fase 4** (próxima) cubrirá: diagnóstico two-tier (safe report por
  defecto, fixture opt-in con preview), matriz OWASP completa en
  `docs/SECURITY.md`, threat model, y release Firefox AMO.
- Si encuentras un bug, abre un issue con el resultado del smoke
  (qué acción, qué esperabas, qué obtuviste) y la URL del intento
  (con `sesskey`/`attempt` redactados a `__REDACTED__`).