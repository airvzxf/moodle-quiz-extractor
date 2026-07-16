# moodle-quiz-extractor

Extensión de Firefox (MV3) para **exportar cuestionarios de Moodle a Markdown local** con imágenes descargadas y, opcionalmente, **autollenado seguro de respuestas** a partir de una lista en texto plano.

> **Local-first.** La extensión nunca envía tus cuestionarios ni respuestas a ningún servidor. Procesa todo dentro del navegador con tu sesión de Moodle activa.

---

## Características (MVP)

- Extracción de un cuestionario a un archivo Markdown autocontenido.
- Descarga de las imágenes referenciadas y empaquetado en un ZIP junto al `.md`, un `.json` canónico y un manifiesto.
- Detección automática de la página de intento (`/mod/quiz/attempt.php*`).
- Redacción automática de secretos (`sesskey`, `MoodleSession`, `attempt`, `cmid`) en cualquier artefacto que salga de la extensión.

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
Tipo de respuesta: Radio buttons.
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
Tipo de respuesta: Checkbox.
Puntaje de 10.00
Sin responder aún
Otra metadata.
```

> **No** se usa `- [ ]` (checklist GFM), **no** se añade frontmatter YAML, **no** se antepone `a. b. c.` a las opciones: el contrato es **literal** al ejemplo.

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
- **Texto libre**: todo lo que sigue al número (línea completa).

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
- El envío final del intento **nunca** se activa desde la extensión (invariante comprobada por spies).

Política de datos: `data_collection_permissions.required: ["none"]`.

## Estado del proyecto

Esta es la **Fase 0 + Fase 1 parcial** del roadmap derivado de la iteración `iter-1` de la mezcla de agentes. Ver `docs/ARCHITECTURE.md` §Fases para el plan completo.

| PR | Alcance |
|---|---|
| #1 | Scaffold WXT MV3 + correcciones obligatorias a T15 |
| #2 | Parser radio/checkbox + detector + content script |
| #3 | Renderer Markdown literal al `prompt.md` + golden file |

## Licencia

Ver [`LICENSE`](LICENSE).
