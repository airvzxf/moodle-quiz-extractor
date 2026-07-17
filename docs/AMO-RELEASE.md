# AMO Release Checklist — moodle-quiz-extractor 0.4.0

Este documento lista los pasos manuales para enviar la extensión
**Moodle Quiz Extractor** a **Mozilla Add-ons (AMO)**. La build y los
artefactos se generan automáticamente en CI (workflow `.github/workflows/release.yml`)
al pushear un tag `v*`. La publicación en AMO es 100% manual
porque requiere credenciales y 2FA del developer.

## Pre-requisitos

1. Cuenta Mozilla en https://accounts.firefox.com/ con **2FA habilitado**
   (recomendado por seguridad y obligatorio para AMO API).
2. Email válido en la cuenta (Mozilla lo usa para notificaciones de review).
3. Permiso `ADMIN` o `MAINTAINER` en la organización del developer.

## Artefactos producidos por CI

Tras mergear PR 4.4 y pushear el tag `v0.4.0`, el workflow `Release`
sube al GitHub Release los siguientes archivos:

| Archivo | Tamaño esperado | Para |
|---|---|---|
| `moodle-quiz-extractor-0.4.0-firefox.zip` | ~77 KB | Subir a AMO |
| `moodle-quiz-extractor-0.4.0-sources.zip` | ~318 KB | Source submission |
| `SHA256SUMS-0.4.0.txt` | < 1 KB | Auditoría |

El ZIP de extensión NO está firmado por Mozilla. AMO devuelve el
archivo firmado tras la revisión. **El archivo firmado** es el que
los usuarios finales instalan.

## Pasos manuales

### 1. Verificación local (5 min)

```bash
# Checkout del tag
git fetch --tags
git checkout v0.4.0

# Re-generar artefactos localmente (debe coincidir con SHA256)
pnpm install --frozen-lockfile
pnpm prepare
pnpm compile
pnpm test
pnpm build:firefox
pnpm lint:ext
pnpm redact
pnpm zip:firefox

# Comparar SHA256
sha256sum .output/*-firefox.zip
# Comparar con el SHA256SUMS-0.4.0.txt del Release
```

Si los hashes no coinciden, NO enviar a AMO. Investigar primero.

### 2. Cargar temporalmente (1 min)

1. Abre Firefox 140+ desktop.
2. Visita `about:debugging#/runtime/this-firefox`.
3. **Cargar complemento temporal** → selecciona
   `moodle-quiz-extractor-0.4.0-firefox.zip`.
4. Navega a un cuestionario Moodle de prueba.
5. Verifica: Extraer → ZIP, Autocompletar → Validar/Aplicar/Cancelar,
   Diagnóstico → Ver reporte (safe).

Si algo falla, abre un issue antes de enviar a AMO.

### 3. Subir a AMO (15 min)

1. Visita https://addons.mozilla.org/en-US/developers/addons.
2. **Submit a New Add-on** → **Firefox**.
3. Arrastra `moodle-quiz-extractor-0.4.0-firefox.zip`.
4. Espera la validación automática (1-5 min).

Si pasa, AMO pregunta:

> "Do you need to provide source code?"

Responde **Yes** y sube `moodle-quiz-extractor-0.4.0-sources.zip`
(tope 200 MB, nuestro es < 1 MB).

### 4. Formulario de metadata

| Campo | Valor |
|---|---|
| **Name** | Moodle Quiz Extractor |
| **Summary** (≤ 250 chars) | Exporta cuestionarios de Moodle a Markdown local con imágenes y autollenado seguro. Local-first, sin telemetría. |
| **Description** (markdown) | Ver `README.md` §Características y §Cómo se aplica |
| **Categories** | Education |
| **License** | MIT (ver `LICENSE`) |
| **Privacy policy** | Esta extensión no recopila, almacena ni transmite datos del usuario. Política completa en `docs/SECURITY.md`. |
| **Homepage** | https://github.com/airvzxf/moodle-quiz-extractor |
| **Support email** | israel.alberto.rv@gmail.com |

### 5. Notes to Reviewer

Pega el siguiente bloque (o similar) en el campo "Notes to Reviewer":

```
This extension is local-first. It does NOT send any user data to any
external server. The full source code is uploaded.

Permissions rationale:
- activeTab: inject content script when user clicks the toolbar
  icon while on a Moodle attempt page.
- storage: persist the popup's work-in-progress state in
  storage.session (TTL 30 min, per-window).
- scripting: dynamically inject the content script into Moodle tabs.
- downloads: trigger browser.downloads.download to save the ZIP.
- host_permissions: *://*/*mod/quiz/attempt.php* is required for
  content script matching. <all_urls> is requested ONLY when the
  user clicks "Descargar ZIP" and only for the page's origin
  (scoped via originPatternFor(tabUrl)).
- data_collection_permissions.required: ["none"] declares no
  data collection per Firefox's built-in consent.

The 2 web-ext lint warnings ("DANGEROUS_EVAL") come from the Zod
4.4.3 feature detection (Function("") inside its own runtime
probe). No first-party code uses eval() or new Function().

Build instructions for reviewers:
  pnpm install --frozen-lockfile
  pnpm prepare
  pnpm build:firefox
```

### 6. Submit Version

Pulsa **Submit Version**. Estado inicial: **Awaiting Review**.

### 7. Espera y respuestas

- Cola típica de AMO: **1-7 días** (puede ser más en release freezes).
- Mozilla suele pedir aclaraciones; responde con un nuevo ZIP versionado
  (0.4.1, etc.) si hay cambios.
- Una vez aprobado, AMO firma el ZIP automáticamente. Descárgalo y
  sírvelo desde tu canal preferido (GitHub Releases auto-update
  opcional, ver Fase 5).

## Post-aprobación

1. Actualiza `docs/SECURITY.md` reemplazando el bloque "Amenazas
   conocidas y diferidas (Fase 5+)" con el estado real de Fase 5.
2. Crea el siguiente milestone (0.5.0) si hay fixes necesarios.
3. Celebra con el usuario. ☕

## Rollback

Si después de aprobar hay un bug crítico:

1. Pulsa **Disable Add-on** en el Developer Hub.
2. Sube la versión 0.4.1 con el fix.
3. Notifica en el repo y en el canal de soporte.

AMO no permite borrar versiones aprobadas; solo deshabilitar y subir
patches.