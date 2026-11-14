#!/usr/bin/env bash
set -Eeuo pipefail

REPO="MaximilianGT500/moecloud"
SITE="${MOECLOUD_SITE:-https://moecloud.moestudio.net}"
IMAGE="ghcr.io/maximiliangt500/moecloud"
DIR="${MOECLOUD_DIR:-/opt/moecloud}"
BIN="${MOECLOUD_BIN:-/usr/local/bin/moecloud}"
LOG="${MOECLOUD_LOG:-/var/log/moecloud-install.log}"
REF="${MOECLOUD_REF:-}"
DOMAIN=""
CLAMAV=""
DATABASE=""
PORT=""
VERSION=""
AUTO_UPDATE=""
YES=0
MODE="install"
PIN=0
WARNINGS=0
MEMORY=0

bold=""
dim=""
green=""
yellow=""
red=""
reset=""
if [ -t 1 ]; then
  bold=$'\033[1m'
  dim=$'\033[2m'
  green=$'\033[32m'
  yellow=$'\033[33m'
  red=$'\033[31m'
  reset=$'\033[0m'
fi

log() { [ -w "$LOG" ] && printf '%s\n' "$@" | sed 's/\x1b\[[0-9;]*m//g' >>"$LOG" || true; }
say() {
  printf '%s\n' "$*"
  log "$*"
}
step() {
  printf '\n%s▸ %s%s\n' "$bold" "$*" "$reset"
  log "" "▸ $*"
}
ok() {
  printf '%s✓%s %s\n' "$green" "$reset" "$*"
  log "✓ $*"
}
warn() {
  WARNINGS=$((WARNINGS + 1))
  printf '%s!%s %s\n' "$yellow" "$reset" "$*"
  log "! $*"
}
fail() {
  printf '%sFehler:%s %s\n' "$red" "$reset" "$*" >&2
  log "Fehler: $*"
  exit 1
}

on_error() {
  local code="$1" line="$2"
  trap - ERR
  printf '\n%sDas hat nicht geklappt%s (Zeile %s, Code %s).\n' "$red" "$reset" "$line" "$code" >&2
  if [ -s "$LOG" ]; then
    printf 'Die letzten Zeilen aus %s:\n' "$LOG" >&2
    tail -n 15 "$LOG" | sed 's/^/  /' >&2
  fi
  printf 'Wenn du nicht weiterkommst, schreib uns unter https://github.com/%s/issues\n' "$REPO" >&2
  exit "$code"
}
trap 'on_error $? $LINENO' ERR

usage() {
  cat <<EOF
MoeCloud installieren oder aktualisieren

  curl -fsSL ${SITE}/install.sh | sudo bash
  curl -fsSL ${SITE}/install.sh | sudo bash -s -- [Optionen]

Optionen:
  --domain <name>     Eigene Domain mit HTTPS über Caddy, zum Beispiel cloud.example.com
  --port <port>       Port ohne Domain (Standard 3000)
  --clamav            ClamAV als Virenscan mitstarten (braucht etwa 3 GB Arbeitsspeicher)
  --no-clamav         ClamAV nicht einrichten
  --postgres          PostgreSQL als Datenbank mitstarten statt SQLite
  --sqlite            SQLite als Datenbank nehmen (Standard)
  --version <x.y.z>   Diese Version installieren und festhalten, latest hebt das wieder auf
  --auto-update       Updates jede Nacht automatisch einspielen
  --no-auto-update    Automatische Updates ausschalten
  --dir <ordner>      Installationsordner (Standard /opt/moecloud)
  --update            Eine bestehende Installation aktualisieren
  --check             Nur prüfen, ob der Server passt, nichts verändern
  --yes               Keine Rückfragen, Standardwerte nehmen
  --help              Diese Hilfe

Das Protokoll liegt in ${LOG}.
EOF
}

value_of() {
  [ "$2" -ge 2 ] || fail "Nach $1 fehlt ein Wert."
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain)
      value_of "$1" $#
      DOMAIN="$2"
      shift
      ;;
    --port)
      value_of "$1" $#
      PORT="$2"
      shift
      ;;
    --clamav) CLAMAV="yes" ;;
    --no-clamav) CLAMAV="no" ;;
    --postgres) DATABASE="postgres" ;;
    --sqlite) DATABASE="sqlite" ;;
    --version)
      value_of "$1" $#
      VERSION="$2"
      shift
      ;;
    --auto-update) AUTO_UPDATE="yes" ;;
    --no-auto-update) AUTO_UPDATE="no" ;;
    --dir)
      value_of "$1" $#
      DIR="${2%/}"
      shift
      ;;
    --update) MODE="update" ;;
    --check) MODE="check" ;;
    --yes | -y) YES=1 ;;
    --help | -h)
      usage
      exit 0
      ;;
    *) fail "Unbekannte Option: $1 (Hilfe mit --help)" ;;
  esac
  shift
done

[[ $DIR =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "Der Installationsordner muss ein absoluter Pfad aus Buchstaben, Ziffern, Punkt, Minus und Unterstrich sein, zum Beispiel /opt/moecloud."

can_ask() { [ "$YES" -eq 0 ] && { : </dev/tty; } 2>/dev/null; }

ask() {
  local prompt="$1" default="$2" answer=""
  if can_ask; then
    printf '%s%s%s ' "$bold" "$prompt" "$reset" >/dev/tty
    [ -n "$default" ] && printf '%s[%s]%s ' "$dim" "$default" "$reset" >/dev/tty
    IFS= read -r answer </dev/tty || answer=""
  fi
  printf '%s' "${answer:-$default}"
}

confirm() {
  local answer
  answer="$(ask "$1 (j/n)" "$2")"
  case "$answer" in
    j | J | ja | Ja | y | Y | yes) return 0 ;;
    *) return 1 ;;
  esac
}

task() {
  local label="$1" pid
  shift
  printf '%s … ' "$label"
  log "" "\$ $*"
  "$@" >>"$LOG" 2>&1 &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    sleep 2
    [ -t 1 ] && printf '.'
  done
  if wait "$pid"; then
    printf '%sfertig%s\n' "$green" "$reset"
    log "✓ $label"
  else
    printf '%sfehlgeschlagen%s\n' "$red" "$reset"
    log "✗ $label"
    return 1
  fi
}

compose() { (cd "$DIR" && docker compose "$@"); }

env_get() { [ -f "$DIR/.env" ] && sed -n "s/^$1=//p" "$DIR/.env" | tail -n 1 || true; }

env_set() {
  local key="$1" value="$2" file="$DIR/.env"
  touch "$file"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

env_unset() { [ -f "$DIR/.env" ] && sed -i "/^$1=/d" "$DIR/.env" || true; }

semver() { [[ $1 =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; }

older() { [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | sed -n 1p)" = "$1" ]; }

latest_version() {
  curl -fsSL --max-time 15 "$SITE/version.json" 2>/dev/null |
    tr -d '\n' |
    sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([0-9][0-9.]*\)".*/\1/p' || true
}

existing_dir() {
  local path="$1"
  while [ ! -d "$path" ]; do path="$(dirname "$path")"; done
  printf '%s' "$path"
}

port_busy() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk -v port="$1" '{ n = split($4, part, ":"); if (part[n] == port) found = 1 } END { exit !found }'
  else
    (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
  fi
}

free_port() {
  local port="$1"
  while port_busy "$port"; do
    port=$((port + 1))
    [ "$port" -lt "$(($1 + 100))" ] || return 1
  done
  printf '%s' "$port"
}

normalize_domain() {
  DOMAIN="${DOMAIN#https://}"
  DOMAIN="${DOMAIN#http://}"
  DOMAIN="${DOMAIN%%/*}"
  DOMAIN="$(printf '%s' "$DOMAIN" | tr '[:upper:]' '[:lower:]')"
  if [ -n "$DOMAIN" ] && ! [[ $DOMAIN =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
    fail "Die Domain $DOMAIN ist ungültig."
  fi
}

init_log() {
  mkdir -p "$(dirname "$LOG")"
  touch "$LOG"
  chmod 600 "$LOG"
  log "" "==== $(date '+%Y-%m-%d %H:%M:%S') install.sh ${MODE} ===="
}

check_system() {
  step "Server prüfen"
  [ "$(uname -s)" = "Linux" ] || fail "Dieses Skript läuft nur unter Linux. Für andere Systeme steht im README, wie es mit Docker Desktop geht."
  local arch os free target
  arch="$(uname -m)"
  case "$arch" in
    x86_64 | amd64 | aarch64 | arm64) ok "Architektur $arch" ;;
    *) fail "Für $arch gibt es kein fertiges Image, nur für amd64 und arm64." ;;
  esac
  os="$(sed -n 's/^PRETTY_NAME=//p' /etc/os-release 2>/dev/null | tr -d '"' || true)"
  [ -n "$os" ] && ok "System $os"
  MEMORY="$(awk '/MemTotal/ { printf "%d", $2 / 1024 }' /proc/meminfo 2>/dev/null || echo 0)"
  if [ "$MEMORY" -lt 900 ]; then
    warn "Nur $MEMORY MB Arbeitsspeicher. MoeCloud braucht mindestens 1 GB, mit ClamAV etwa 4 GB."
  else
    ok "Arbeitsspeicher $MEMORY MB"
  fi
  target="$(existing_dir "$DIR")"
  free="$(df -Pm "$target" 2>/dev/null | awk 'NR == 2 { print $4 }' || echo 0)"
  if [ "${free:-0}" -lt 2048 ]; then
    warn "Unter $target sind nur ${free:-0} MB frei. Plane genug Platz für deine Dateien ein."
  else
    ok "Freier Platz $((free / 1024)) GB unter $target"
  fi
}

check_ports() {
  local port busy=""
  if [ -n "$DOMAIN" ]; then
    for port in 80 443; do
      if port_busy "$port"; then busy="$busy $port"; fi
    done
    if [ -n "$busy" ]; then
      fail "Port${busy} ist schon belegt, vermutlich von einem anderen Webserver. Stopp ihn oder installiere ohne --domain und leite deinen Webserver auf MoeCloud weiter."
    fi
    ok "Ports 80 und 443 sind frei"
    local wanted="$PORT"
    PORT="$(free_port "$PORT")" || fail "Zwischen $wanted und $((wanted + 99)) ist kein Port für MoeCloud frei."
    [ "$PORT" = "$wanted" ] || ok "MoeCloud nimmt intern Port $PORT, weil $wanted belegt ist"
  else
    if port_busy "$PORT"; then fail "Port $PORT ist schon belegt. Nimm einen anderen mit --port."; fi
    ok "Port $PORT ist frei"
  fi
}

check_dns() {
  [ -n "$DOMAIN" ] && command -v getent >/dev/null 2>&1 || return 0
  local resolved addresses ip
  resolved="$(getent ahosts "$DOMAIN" 2>/dev/null | awk '{ print $1 }' | sort -u | tr '\n' ' ' || true)"
  if [ -z "$resolved" ]; then
    warn "$DOMAIN zeigt noch auf keinen Server. Leg einen A- oder AAAA-Eintrag an, sonst bekommt Caddy kein Zertifikat."
    return 0
  fi
  addresses=" $(hostname -I 2>/dev/null || true) "
  for ip in $resolved; do
    case "$addresses" in
      *" $ip "*)
        ok "$DOMAIN zeigt auf diesen Server ($ip)"
        return 0
        ;;
    esac
  done
  warn "$DOMAIN zeigt auf ${resolved% }. Steht der Server hinter NAT oder einer Cloud-Firewall, ist das normal, sonst prüf den DNS-Eintrag."
}

check_registry() {
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 https://ghcr.io/v2/ 2>/dev/null || true)"
  case "$code" in
    200 | 401) ok "Die GitHub Container Registry ist erreichbar" ;;
    *) warn "ghcr.io ist gerade nicht erreichbar. Ohne Verbindung dorthin lässt sich das Image nicht laden." ;;
  esac
}

ensure_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    [ "$MODE" = "check" ] && {
      warn "Docker fehlt, das Skript würde es über get.docker.com einrichten"
      return 0
    }
    step "Docker installieren"
    say "Docker fehlt auf diesem Server. Das offizielle Skript von get.docker.com richtet es ein."
    if [ "$YES" -eq 1 ] || confirm "Docker jetzt installieren?" "j"; then
      task "Docker installieren" sh -c 'curl -fsSL https://get.docker.com | sh'
    else
      fail "Ohne Docker geht es nicht weiter. Wie MoeCloud direkt mit Node.js läuft, steht im README."
    fi
  fi
  if ! docker info >/dev/null 2>&1; then
    [ "$MODE" = "check" ] && {
      warn "Docker ist installiert, läuft aber gerade nicht"
      return 0
    }
    systemctl enable --now docker >/dev/null 2>&1 || service docker start >/dev/null 2>&1 || true
    sleep 2
    docker info >/dev/null 2>&1 || fail "Docker ist installiert, läuft aber nicht. Prüf es mit: systemctl status docker"
  fi
  if ! docker compose version >/dev/null 2>&1; then
    fail "Docker Compose fehlt. Installiere das Paket docker-compose-plugin, unter Ubuntu heißt es auch docker-compose-v2."
  fi
  ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '?') mit Compose $(docker compose version --short 2>/dev/null || echo '?')"
}

resolve_version() {
  local current pinned
  current="$(env_get MOECLOUD_VERSION)"
  pinned="$(env_get MOECLOUD_PIN)"
  VERSION="${VERSION#v}"
  if [ -z "$VERSION" ] && [ "$pinned" = "1" ] && [ -n "$current" ]; then
    VERSION="$current"
    say "Version $current ist festgehalten. Mit --version latest gehst du wieder auf die neueste."
  fi
  if [ -z "$VERSION" ] || [ "$VERSION" = "latest" ]; then
    PIN=0
    VERSION="$(latest_version)"
    if [ -z "$VERSION" ]; then
      warn "Die neueste Version ließ sich nicht abfragen, das Skript nimmt das Image latest."
      VERSION="latest"
    fi
  else
    semver "$VERSION" || fail "Die Version $VERSION ist ungültig, gib sie als x.y.z an."
    PIN=1
  fi
  if semver "$VERSION" && semver "$current" && older "$VERSION" "$current"; then
    fail "Installiert ist $current. Zurück auf $VERSION geht nicht, weil sich die Datenbank verändert haben kann. Spiel dafür eine Sicherung ein."
  fi
  if [ -z "$REF" ]; then
    REF="main"
    if semver "$VERSION" && curl -fsSIL --max-time 15 "https://raw.githubusercontent.com/${REPO}/v${VERSION}/docker-compose.yml" >/dev/null 2>&1; then
      REF="v${VERSION}"
    fi
  fi
}

download() {
  local source="$1" target="$2"
  curl -fsSL --retry 3 --max-time 60 "https://raw.githubusercontent.com/${REPO}/${REF}/${source}" -o "${target}.neu" ||
    fail "${source} ließ sich nicht von GitHub laden."
  mv "${target}.neu" "$target"
}

fetch_files() {
  mkdir -p "$DIR/docker"
  download docker-compose.yml "$DIR/docker-compose.yml"
  sed -i '/^[[:space:]]*build: \.$/d' "$DIR/docker-compose.yml"
  if [ -d "$DIR/docker/Caddyfile" ]; then rmdir "$DIR/docker/Caddyfile" 2>/dev/null || true; fi
  download docker/Caddyfile "$DIR/docker/Caddyfile"
  download docker/clamav.yml "$DIR/docker/clamav.yml"
  download docker/postgres.yml "$DIR/docker/postgres.yml"
  download install.sh "$DIR/install.sh"
  chmod 700 "$DIR/install.sh"
  download docker/moecloud-host "$BIN"
  sed -i "s|^DIR=.*|DIR=\"\${MOECLOUD_DIR:-$DIR}\"|" "$BIN"
  chmod 755 "$BIN"
}

container_state() {
  local id
  id="$(compose ps -q moecloud 2>/dev/null || true)"
  [ -n "$id" ] || {
    printf 'missing'
    return 0
  }
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || printf 'missing'
}

wait_healthy() {
  local state="" _
  printf 'MoeCloud startet … '
  for _ in $(seq 1 90); do
    state="$(container_state)"
    case "$state" in
      healthy | running)
        printf '%sbereit%s\n' "$green" "$reset"
        return 0
        ;;
      unhealthy | exited | dead) break ;;
    esac
    sleep 2
    [ -t 1 ] && printf '.'
  done
  printf '%snicht bereit%s\n' "$red" "$reset"
  say "Status: $state. Die letzten Zeilen aus dem Log:"
  compose logs --tail=30 moecloud 2>&1 | sed 's/^/  /' || true
  fail "MoeCloud ist nicht hochgekommen. Mehr steht in: sudo moecloud logs"
}

backup_before_update() {
  [ "$(container_state)" = "healthy" ] || return 0
  if compose exec -T moecloud moecloud backup >>"$LOG" 2>&1; then
    ok "Datenbank gesichert in $DIR/data/backups"
  else
    warn "Die Sicherung vor dem Update hat nicht geklappt. MoeCloud sichert die Datenbank beim Start trotzdem selbst."
  fi
}

prune_images() {
  docker images "$IMAGE" --filter dangling=true -q 2>/dev/null | xargs -r docker rmi >>"$LOG" 2>&1 || true
}

auto_update() {
  if [ "$1" = "yes" ]; then
    if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
      "$BIN" auto-update on || warn "Automatische Updates ließen sich nicht einschalten."
    else
      warn "Ohne systemd gibt es keine automatischen Updates. Aktualisiere mit: sudo moecloud update"
    fi
  elif [ -f /etc/systemd/system/moecloud-update.timer ]; then
    "$BIN" auto-update off
  fi
}

address() {
  local ip
  if [ -n "$DOMAIN" ]; then
    printf 'https://%s' "$DOMAIN"
  else
    ip="$(hostname -I 2>/dev/null | awk '{ print $1 }' || true)"
    printf 'http://%s:%s' "${ip:-localhost}" "$PORT"
  fi
}

setup_link() {
  local link="" _
  for _ in $(seq 1 10); do
    link="$(compose exec -T moecloud moecloud setup-link 2>/dev/null | grep -o 'https\?://[^ ]*setup?code=[A-Za-z0-9_-]*' | tail -n 1 || true)"
    [ -n "$link" ] && break
    sleep 2
  done
  printf '%s' "${link/http:\/\/localhost:3000/$(address)}"
}

check_port_value() {
  PORT="${PORT:-3000}"
  case "$PORT" in '' | *[!0-9]*) fail "Der Port muss eine Zahl sein." ;; esac
  if [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then fail "Der Port muss zwischen 1 und 65535 liegen."; fi
}

settings() {
  step "Einstellungen"
  if [ -z "$DOMAIN" ] && [ "$YES" -eq 0 ]; then
    DOMAIN="$(ask "Domain für HTTPS, leer lassen für Zugriff über die IP:" "")"
  fi
  normalize_domain
  if [ -z "$DOMAIN" ] && [ -z "$PORT" ]; then PORT="$(ask "Port:" "3000")"; fi
  check_port_value
  if [ -z "$CLAMAV" ]; then
    if [ "$YES" -eq 1 ]; then
      CLAMAV="no"
    else
      say "ClamAV prüft jede hochgeladene Datei auf Schadsoftware und braucht dafür etwa 3 GB Arbeitsspeicher."
      say "Dieser Server hat $MEMORY MB."
      if confirm "ClamAV einrichten?" "$([ "$MEMORY" -ge 3500 ] && echo j || echo n)"; then CLAMAV="yes"; else CLAMAV="no"; fi
    fi
  fi
  if [ "$CLAMAV" = "yes" ] && [ "$MEMORY" -lt 3000 ]; then
    warn "Mit $MEMORY MB wird es für ClamAV eng. Läuft der Server voll, schalte den Virenscan wieder ab."
  fi
  if [ -z "$DATABASE" ]; then
    if [ "$YES" -eq 1 ]; then
      DATABASE="sqlite"
    else
      say "MoeCloud speichert Konten und Ordner in SQLite, das braucht keinen eigenen Dienst."
      say "PostgreSQL lohnt sich bei vielen Konten oder wenn der Datenordner auf einem Netzlaufwerk liegt."
      if confirm "PostgreSQL statt SQLite einrichten?" "n"; then DATABASE="postgres"; else DATABASE="sqlite"; fi
    fi
  fi
  if [ -z "$AUTO_UPDATE" ]; then
    if [ "$YES" -eq 0 ] && confirm "Updates jede Nacht automatisch einspielen?" "n"; then AUTO_UPDATE="yes"; else AUTO_UPDATE="no"; fi
  fi
}

update() {
  [ -f "$DIR/docker-compose.yml" ] || fail "In $DIR liegt keine Installation. Ohne --update installierst du MoeCloud neu."
  ensure_docker
  local previous
  previous="$(env_get MOECLOUD_VERSION)"
  resolve_version
  step "MoeCloud aktualisieren"
  backup_before_update
  fetch_files
  env_set MOECLOUD_INSTALL script
  env_set MOECLOUD_VERSION "$VERSION"
  env_set MOECLOUD_PIN "$PIN"
  task "Images laden" compose pull
  task "Container neu starten" compose up -d --remove-orphans
  wait_healthy
  prune_images
  [ -n "$AUTO_UPDATE" ] && auto_update "$AUTO_UPDATE"
  if [ -n "$previous" ] && [ "$previous" != "$VERSION" ]; then
    ok "MoeCloud ist jetzt auf $VERSION, vorher $previous"
  else
    ok "MoeCloud $VERSION ist aktuell"
  fi
}

install() {
  check_system
  ensure_docker
  check_registry
  settings
  check_ports
  check_dns
  resolve_version

  step "Dateien anlegen"
  mkdir -p "$DIR/data"
  fetch_files
  local timezone
  timezone="$(cat /etc/timezone 2>/dev/null || timedatectl show -p Timezone --value 2>/dev/null || echo Europe/Berlin)"
  env_set TZ "$timezone"
  env_set MOECLOUD_INSTALL script
  env_set MOECLOUD_VERSION "$VERSION"
  env_set MOECLOUD_PIN "$PIN"
  env_set MOECLOUD_PORT "$PORT"
  if [ -n "$DOMAIN" ]; then
    env_set DOMAIN "$DOMAIN"
    env_set PUBLIC_URL "https://$DOMAIN"
    env_set COMPOSE_PROFILES caddy
    env_set MOECLOUD_BIND 127.0.0.1
  fi
  local files="docker-compose.yml"
  [ "$CLAMAV" = "yes" ] && files="$files:docker/clamav.yml"
  if [ "$DATABASE" = "postgres" ]; then
    files="$files:docker/postgres.yml"
    [ -n "$(env_get POSTGRES_PASSWORD)" ] || env_set POSTGRES_PASSWORD "$(od -An -tx1 -N24 /dev/urandom | tr -d ' \n')"
    mkdir -p "$DIR/postgres"
  fi
  if [ "$files" = "docker-compose.yml" ]; then env_unset COMPOSE_FILE; else env_set COMPOSE_FILE "$files"; fi
  chmod 600 "$DIR/.env"
  chown 1000:1000 "$DIR/data"
  ok "Einstellungen in $DIR/.env"

  step "MoeCloud starten"
  task "Images laden (das dauert beim ersten Mal ein paar Minuten)" compose pull
  task "Container starten" compose up -d
  wait_healthy
  auto_update "$AUTO_UPDATE"

  step "Fertig"
  local link
  link="$(setup_link)"
  if [ "$DATABASE" = "postgres" ]; then
    say "PostgreSQL läuft als eigener Dienst, seine Daten liegen in $DIR/postgres."
  fi
  if [ -n "$DOMAIN" ]; then
    say "Zeigt $DOMAIN auf diesen Server und sind die Ports 80 und 443 offen, holt Caddy das Zertifikat beim ersten Aufruf."
    say "Prüf bei deinem Anbieter, ob die Firewall die Ports freigibt."
  fi
  if [ -n "$link" ]; then
    say "Öffne diesen Link im Browser und leg dein Konto an:"
    say ""
    say "  ${bold}${link}${reset}"
  else
    say "Den Link zur Einrichtung zeigt ${bold}sudo moecloud setup-link${reset}."
  fi
  say ""
  say "Nützliche Befehle:"
  say "  sudo moecloud status     Zustand, Version und Adresse"
  say "  sudo moecloud doctor     Typische Probleme finden"
  say "  sudo moecloud logs       Logs ansehen"
  say "  sudo moecloud update     Auf die neueste Version aktualisieren"
  say "  sudo moecloud help       Alle Befehle"
}

check_only() {
  normalize_domain
  check_port_value
  check_system
  ensure_docker
  check_registry
  if [ -f "$DIR/docker-compose.yml" ]; then
    ok "In $DIR liegt schon eine Installation, ein erneuter Aufruf aktualisiert sie"
  else
    check_ports
  fi
  check_dns
  step "Ergebnis"
  if [ "$WARNINGS" -eq 0 ]; then
    ok "Der Server passt."
  else
    say "Der Server passt, schau dir die $WARNINGS Hinweise oben an."
  fi
}

[ "$(id -u)" -eq 0 ] || fail "Starte das Skript mit sudo, es richtet Docker und den Ordner $DIR ein."
command -v curl >/dev/null 2>&1 || fail "curl fehlt. Installiere es zuerst, zum Beispiel mit apt install curl."
init_log

say "${bold}MoeCloud${reset}: deine Dateien auf deinem Server"
say "${dim}Ordner $DIR · Protokoll $LOG${reset}"

case "$MODE" in
  check) check_only ;;
  update) update ;;
  *)
    if [ -f "$DIR/docker-compose.yml" ]; then
      say "In $DIR gibt es schon eine Installation. Sie wird aktualisiert, deine Daten bleiben."
      update
    else
      install
    fi
    ;;
esac
