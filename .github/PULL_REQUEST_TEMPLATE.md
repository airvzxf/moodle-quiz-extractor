## Resumen

<!-- Qué cambia y por qué. Con «Closes #N» el issue se cierra al fusionar. -->

Closes #

## Tipo de cambio

- [ ] `feat`: función nueva
- [ ] `fix`: corrección de un error
- [ ] `refactor`: cambio interno sin cambio de comportamiento
- [ ] `test`: sólo pruebas
- [ ] `docs`: sólo documentación
- [ ] `ci`: workflows o Dependabot
- [ ] `deps`/`chore`: dependencias o mantenimiento

## Validación

Los checks requeridos del ruleset `protect-main` son `actionlint`,
`Compilar, probar y empaquetar`, `Humo (chrome)` y `Humo (firefox)`.
En local:

- [ ] `pnpm compile` y `pnpm test` pasan
- [ ] `pnpm smoke:chrome` y `pnpm smoke:firefox` pasan (si cambia la extensión)
- [ ] Si toca la lectura de páginas de Moodle: probado contra el laboratorio o un Moodle real (indica la versión)

## Seguridad y privacidad

- [ ] No incluye cookies, tokens ni datos personales (tampoco en fixtures)
- [ ] La extensión sigue sin enviar el intento (ningún POST a Moodle)
- [ ] Si agrega permisos al manifiesto, se explica por qué
