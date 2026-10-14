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
- **Exportar la revisión**: en la revisión de un intento terminado (`review.php`) el mismo
  botón descarga `<curso-unidad-titulo>-revision.zip` con lo que contestaste, si cada
  pregunta y opción fue correcta (✅ ◐ ❌ ➖), la puntuación, el resumen del intento y,
  cuando Moodle los muestra, la respuesta correcta y la retroalimentación. Si la revisión
  está paginada, incluye todas las preguntas. En la revisión no hay autollenado.
- **Modo detallado** (casilla): el Markdown marca con `- [x]` lo que ya está seleccionado y
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

Pensado para verse bien en GitHub, Obsidian o VS Code: imágenes visibles, opciones como
casillas y los datos de cada pregunta plegados. Con *Modo detallado* se marcan con
`- [x]` las opciones seleccionadas y se añaden datos técnicos.

```markdown
# Actividad 1. Cuestionario

**Curso:** 02 – Sistemas operativos – DSOP · **Unidad:** Unidad 1

---

### 2. Relaciona las siguientes columnas:

![Unir elementos segun corresponda la descripción](./quiz/A2_Examen_U1.png)

Selecciona una opción:
- [ ] a. 1A, 2C, 3D, 4B
- [ ] b. 1C, 2A, 3D, 4B
- [ ] c. 1D, 2B, 3A, 4C
- [ ] d. 1B, 2A, 3C, 4D

<details><summary>Datos</summary>

- **Tipo:** opción única
- Puntaje de 10.00
- Sin responder aún

</details>
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
pnpm smoke:lab        # Chromium contra el laboratorio Moodle (ver abajo)
```

Cargar en Firefox: `about:debugging#/runtime/this-firefox` → *Cargar complemento
temporal…* → `.output/firefox-mv3/manifest.json`.
Cargar en Chrome: `chrome://extensions` → *Modo de desarrollador* → *Cargar
descomprimida* → `.output/chrome-mv3`.

### Laboratorio Moodle

Un Moodle 5.3 real en tu máquina, con cuestionarios inventados que cubren todos los
casos: una página, varias páginas con navegación libre y secuencial, imágenes, opción
múltiple, tipos no soportados e intentos terminados para la revisión. Así no hace falta
usar exámenes reales ni se filtran preguntas, respuestas ni sesiones.

Requisitos: `podman`, unos 2 GB de disco y ~8 minutos la primera vez.

```bash
tools/moodle-lab/lab.sh up        # descarga, instala y siembra → http://127.0.0.1:8765
pnpm smoke:lab                    # la extensión real en Chromium contra el laboratorio
pnpm lab:capture                  # vuelve a capturar tests/fixtures/lab/
tools/moodle-lab/lab.sh seed      # recrea el curso y los intentos
tools/moodle-lab/lab.sh stop      # lo detiene (conserva datos)
tools/moodle-lab/lab.sh destroy   # lo borra todo
```

Usuarios: `estudiante1` / `Estudiante-lab-1` y `admin` / `Admin-lab-1` (sólo locales;
el pod escucha únicamente en `127.0.0.1`). Las preguntas están en
`tools/moodle-lab/questions.xml` (Moodle XML); `seed.php` crea el curso, los
cuestionarios y los intentos. Las versiones de Moodle y de las imágenes están fijadas en
`lab.sh`. Los datos viven en `~/.cache/mqx-moodle-lab` (cámbialo con `MQX_LAB_DIR`).

### Fixtures de prueba

- `tests/fixtures/lab/`: páginas del laboratorio (`pnpm lab:capture`). Son la referencia
  para casos nuevos.
- `tests/fixtures/*.html`: páginas reales de la UnADM **reducidas y sin datos
  personales**, y fixtures sintéticas. No se añaden más páginas de la UnADM: los casos
  nuevos salen del laboratorio.

## Licencia

[GNU AGPL v3](LICENSE).
