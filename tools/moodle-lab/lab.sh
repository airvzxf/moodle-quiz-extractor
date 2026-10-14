#!/usr/bin/env bash
# Laboratorio Moodle local (issue #12): Moodle real en un pod de podman,
# sólo en 127.0.0.1, con cuestionarios sembrados por script.
#
# Uso: tools/moodle-lab/lab.sh <up|seed|status|stop|destroy>
#   up       descarga Moodle (verificado por SHA-256), crea el pod, instala
#            Moodle si hace falta y siembra el contenido.
#   seed     (re)siembra el curso, los usuarios y los cuestionarios.
#   status   muestra el estado del pod y la URL.
#   stop     detiene el pod (conserva datos).
#   destroy  borra el pod y todos los datos del laboratorio.
#
# Variables: MQX_LAB_DIR (por defecto ~/.cache/mqx-moodle-lab),
#            MQX_LAB_PORT (por defecto 8765).
#
# Todo queda fuera del repositorio. Nada escucha fuera de 127.0.0.1.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB_DIR="${MQX_LAB_DIR:-$HOME/.cache/mqx-moodle-lab}"
PORT="${MQX_LAB_PORT:-8765}"
POD="mqx-moodle-lab"
WWWROOT="http://127.0.0.1:${PORT}"

# Versiones fijadas. Para actualizar: cambiar los tres valores juntos y
# comprobar con `lab.sh destroy && lab.sh up`.
MOODLE_URL="https://packaging.moodle.org/stable503/moodle-5.3.tgz"
MOODLE_SHA256="7e5edf110555956571f40e42acffde0eb23681ebebd212a2fec0fe7d795dd511"
PHP_IMAGE="docker.io/moodlehq/moodle-php-apache:8.3@sha256:501f19fa75ad3cdc8962f2a742f39d179b8aa8ffdc2ff233d8d27a32f14e0e05"
DB_IMAGE="docker.io/library/postgres:17@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3"

# Credenciales sólo para este laboratorio local (no son secretos).
DB_PASS="mqx-lab"
ADMIN_PASS="Admin-lab-1"

log() { printf '\033[1m[lab]\033[0m %s\n' "$*"; }

php_cli() {
  podman exec -u www-data "${POD}-web" php "$@"
}

fetch_moodle() {
  local tgz="${LAB_DIR}/moodle-5.3.tgz"
  if [[ ! -f "$tgz" ]] || ! echo "${MOODLE_SHA256}  ${tgz}" | sha256sum -c --status; then
    log "Descargando Moodle 5.3…"
    curl -sSfL -o "$tgz.part" "$MOODLE_URL"
    echo "${MOODLE_SHA256}  ${tgz}.part" | sha256sum -c --status || { echo "SHA-256 no coincide" >&2; exit 1; }
    mv "$tgz.part" "$tgz"
  fi
  if [[ ! -f "${LAB_DIR}/www/public/version.php" ]]; then
    log "Extrayendo Moodle…"
    rm -rf "${LAB_DIR}/www"
    mkdir -p "${LAB_DIR}/www"
    tar -xzf "$tgz" -C "${LAB_DIR}/www" --strip-components=1
  fi
  # config.php propio: sin modo depuración, para que el HTML sea como en
  # producción.
  cat > "${LAB_DIR}/www/config.php" <<PHP
<?php
unset(\$CFG);
global \$CFG;
\$CFG = new stdClass();
\$CFG->dbtype    = 'pgsql';
\$CFG->dblibrary = 'native';
\$CFG->dbhost    = '127.0.0.1';
\$CFG->dbname    = 'moodle';
\$CFG->dbuser    = 'moodle';
\$CFG->dbpass    = '${DB_PASS}';
\$CFG->prefix    = 'm_';
\$CFG->dboptions = [];
\$CFG->wwwroot   = '${WWWROOT}';
\$CFG->dataroot  = '/var/www/moodledata';
\$CFG->admin     = 'admin';
\$CFG->directorypermissions = 0777;
\$CFG->noemailever = true;
require_once(__DIR__ . '/lib/setup.php');
PHP
}

pod_up() {
  mkdir -p "${LAB_DIR}/pgdata" "${LAB_DIR}/moodledata"
  # Apache/PHP corre como www-data (uid 33 dentro del contenedor).
  podman unshare chown 33:33 "${LAB_DIR}/moodledata"
  if ! podman pod exists "$POD"; then
    log "Creando el pod ${POD} en 127.0.0.1:${PORT}…"
    podman pod create --name "$POD" -p "127.0.0.1:${PORT}:80" >/dev/null
    podman run -d --pod "$POD" --name "${POD}-db" \
      -e POSTGRES_USER=moodle -e POSTGRES_PASSWORD="$DB_PASS" -e POSTGRES_DB=moodle \
      -v "${LAB_DIR}/pgdata:/var/lib/postgresql/data:U" \
      "$DB_IMAGE" >/dev/null
    podman run -d --pod "$POD" --name "${POD}-web" \
      -v "${LAB_DIR}/www:/var/www/html:ro" \
      -v "${LAB_DIR}/moodledata:/var/www/moodledata" \
      -v "${HERE}:/lab:ro" \
      "$PHP_IMAGE" >/dev/null
  else
    podman pod start "$POD" >/dev/null
  fi
  log "Esperando a PostgreSQL…"
  for _ in $(seq 1 60); do
    podman exec "${POD}-db" pg_isready -U moodle -h 127.0.0.1 >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "PostgreSQL no respondió" >&2
  exit 1
}

install_moodle() {
  if php_cli /var/www/html/admin/cli/cfg.php --name=release >/dev/null 2>&1; then
    log "Moodle ya está instalado."
    return 0
  fi
  log "Instalando Moodle (tarda unos minutos)…"
  php_cli /var/www/html/admin/cli/install_database.php \
    --agree-license --lang=en --fullname="Moodle laboratorio MQX" --shortname="mqx-lab" \
    --adminuser=admin --adminpass="$ADMIN_PASS" --adminemail=admin@example.invalid \
    --summary="Laboratorio local de moodle-quiz-extractor" | tail -3
}

# Paquetes de idioma es y es_mx (la UnADM usa es_mx). No tienen versión
# fija: Moodle los publica de forma continua para cada rama.
install_langs() {
  local lang
  for lang in es es_mx; do
    if ! podman exec "${POD}-web" test -f "/var/www/moodledata/lang/${lang}/langconfig.php"; then
      log "Instalando idioma ${lang}…"
      curl -sSfL -o "${LAB_DIR}/${lang}.zip" "https://packaging.moodle.org/langpack/5.3/${lang}.zip"
      podman cp "${LAB_DIR}/${lang}.zip" "${POD}-web:/tmp/${lang}.zip"
      podman exec -u www-data "${POD}-web" php -r '
        $z = new ZipArchive();
        if ($z->open($argv[1]) !== true) { exit(1); }
        @mkdir("/var/www/moodledata/lang", 0777, true);
        exit($z->extractTo("/var/www/moodledata/lang") ? 0 : 1);' "/tmp/${lang}.zip"
    fi
  done
  php_cli /var/www/html/admin/cli/purge_caches.php
}

seed() {
  log "Sembrando contenido…"
  php_cli /lab/seed.php > "${LAB_DIR}/seed.json"
  log "Intentos y cmid en ${LAB_DIR}/seed.json"
}

case "${1:-}" in
  up)
    mkdir -p "$LAB_DIR"
    fetch_moodle
    pod_up
    install_moodle
    install_langs
    seed
    log "Listo: ${WWWROOT}  (admin / ${ADMIN_PASS}; estudiantes en seed.php)"
    ;;
  seed) seed ;;
  status)
    podman pod ps --filter "name=^${POD}\$"
    echo "URL: ${WWWROOT}"
    ;;
  stop) podman pod stop "$POD" >/dev/null && log "Detenido." ;;
  destroy)
    podman pod rm -f "$POD" >/dev/null 2>&1 || true
    # pgdata y moodledata pertenecen a UIDs del contenedor: se borran desde
    # el espacio de nombres de podman.
    podman unshare rm -rf "${LAB_DIR}/pgdata" "${LAB_DIR}/moodledata" "${LAB_DIR}/www"
    log "Borrado (se conserva la descarga de Moodle en ${LAB_DIR})."
    ;;
  *)
    sed -n '2,15p' "${BASH_SOURCE[0]}"
    exit 2
    ;;
esac
