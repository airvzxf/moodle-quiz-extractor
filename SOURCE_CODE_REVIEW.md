# Source Code Review Instructions — moodle-quiz-extractor

Mozilla requiere que el código fuente de la extensión sea revisable
cuando el build usa bundlers (Vite/Rollup en este caso, vía WXT).
Este archivo documenta los pasos exactos que el reviewer de AMO
debe seguir para reproducir el binario publicado.

## Build (reproducible)

Requisitos:

- Node.js `20.19.x` o `>= 22.13` (probado con 22.13.1).
- pnpm `10.34.5` (declarado en `package.json#packageManager`).

Pasos:

```bash
git clone git@github.com:airvzxf/moodle-quiz-extractor.git
cd moodle-quiz-extractor
git checkout v0.4.0     # o el tag correspondiente
pnpm install --frozen-lockfile
pnpm prepare            # wxt prepare (regenera .wxt/tsconfig.json)
pnpm build:firefox       # produce .output/firefox-mv3/ con MV3
```

Resultado esperado:

```
.output/firefox-mv3/manifest.json         # manifest_version: 3, version: 0.4.0
.output/firefox-mv3/background.js
.output/firefox-mv3/content-scripts/content.js
.output/firefox-mv3/popup.html
.output/firefox-mv3/icon/16.png ... 128.png
```

SHA-256 esperado del ZIP firmado por AMO: ver
`SHA256SUMS-0.4.0.txt` del GitHub Release.

## Verificación de invariantes de seguridad

```bash
# Ningún archivo de src/ puede importar storage.sync
grep -rn "storage.sync" src/   # debe estar vacío

# Manifest no declara 'cookies' ni nuevos host_permissions
cat .output/firefox-mv3/manifest.json | grep -E '"cookies"'  # debe estar vacío
cat .output/firefox-mv3/manifest.json | grep -E '"host_permissions"'  # solo attempt.php

# Redactor no permite leaks
pnpm redact                   # debe imprimir "Done: 4 fixture(s) verified, 0 blocked."

# Tests adversariales verdes
pnpm test -- tests/security/  # debe ser todo verde
```

## 2 web-ext warnings "DANGEROUS_EVAL"

Estos warnings vienen del bundle minificado de **Zod 4.4.3** y se
deben a su probe interno:

```js
var Ie = De(() => {
  if (we.jitless) return !1;
  try { return Function(""), !0 } catch { return !1 }
});
```

Es feature detection del runtime (no se ejecuta nunca). **No** es
código first-party. Firefox los acepta como falsos positivos cuando
se explica al reviewer. Documentado en `docs/AMO-RELEASE.md` §5.

## Inventario de dependencias runtime

| Paquete | Versión | Licencia | Notas |
|---|---|---|---|
| dompurify | 3.4.12 | Apache-2.0 / MPL-2.0 | Sanitizer HTML antes de Markdown |
| fflate | 0.8.3 | MIT | ZIP bundle |
| tar-stream | 3.2.0 | MIT | Instalado pero NO usado (Fase 5 Native Messaging) |
| turndown | 7.2.4 | MIT | HTML→Markdown |
| zod | 4.4.3 | MIT | Schema validation |

Todas MIT/Apache salvo DOMPurify dual. Ninguna con CVEs críticos al
2026-07. `pnpm audit` corre en CI pero no es gating.

## Archivos no generados por el build

- `resources/*.html` — fixtures crudas del developer. NO se incluyen
  en el source ZIP (`wxt.config.ts` los excluye explícitamente).
- `tests/fixtures/redacted/*.html` — fixtures saneadas, sí incluidas.
- `tools/redact-fixture.mjs` — script de redacción offline, sí incluido.
- `.output/`, `.wxt/`, `node_modules/` — excluidos del source ZIP por
  defecto (WXT).

Para más detalle sobre la arquitectura, ver `docs/ARCHITECTURE.md`.