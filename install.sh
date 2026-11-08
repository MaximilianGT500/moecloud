#!/usr/bin/env bash
set -euo pipefail

REPO="MaximilianGT500/moecloud"
REF="${MOECLOUD_REF:-main}"
DIR="${MOECLOUD_DIR:-/opt/moecloud}"
BIN="${MOECLOUD_BIN:-/usr/local/bin/moecloud}"
RAW="https://raw.githubusercontent.com/${REPO}/${REF}"
DOMAIN=""
CLAMAV=""
PORT=""
YES=0
MODE="install"

bold=""
dim=""
green=""
red=""
reset=""
if [ -t 1 ]; then
  bold=$'\033[1m'
  dim=$'\033[2m'
  green=$'\033[32m'
  red=$'\033[31m'
  reset=$'\033[0m'
fi

say() { printf '%s\n' "$*"; }
step() { printf '\n%s▸ %s%s\n' "$bold" "$*" "$reset"; }
done_() { printf '%s✓%s %s\n' "$green" "$reset" "$*"; }
fail() {
  printf '%sFehler:%s %s\n' "$red" "$reset" "$*" >&2
  exit 1
}

usage() {
  cat <<EOF
MoeCloud installieren oder aktualisieren

  curl -fsSL https://moecloud.moestudio.net/install.sh | sudo bash
  curl -fsSL https://moecloud.moestudio.net/install.sh | sudo bash -s -- [Optionen]

Optionen:
  --domain <name>   Mit eigener Domain und HTTPS über Caddy, zum Beispiel cloud.example.com
  --clamav          ClamAV als Virenscan mitstarten (braucht etwa 3 GB Arbeitsspeicher)
  --no-clamav       ClamAV nicht einrichten
  --port <port>     Port auf dem Server ohne Domain (Standard 3000)
  --dir <ordner>    Installationsordner (Standard /opt/moecloud)
  --update          Eine bestehende Installation aktualisieren
  --yes             Keine Rückfragen, Standardwerte nehmen
  --help            Diese Hilfe
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain)
      [ $# -ge 2 ] || fail "Nach --domain fehlt der Name."
      DOMAIN="$2"
      shift
      ;;
    --clamav) CLAMAV="yes" ;;
    --no-clamav) CLAMAV="no" ;;
    --port)
      [ $# -ge 2 ] || fail "Nach --port fehlt die Zahl."
      PORT="$2"
      shift
      ;;
    --dir)
      [ $# -ge 2 ] || fail "Nach --dir fehlt der Ordner."
      DIR="$2"
      shift
      ;;
    --update) MODE="update" ;;
    --yes | -y) YES=1 ;;
    --help | -h)
      usage
      exit 0
      ;;
    *) fail "Unbekannte Option: $1 (Hilfe mit --help)" ;;
  esac
  shift
done

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

[ "$(id -u)" -eq 0 ] || fail "Starte das Skript mit sudo, es richtet Docker und den Ordner $DIR ein."
command -v curl >/dev/null 2>&1 || fail "curl fehlt. Installiere es zuerst, zum Beispiel mit apt install curl."

compose() { (cd "$DIR" && docker compose "$@"); }

download() {
  local source="$1" target="$2"
  curl -fsSL --retry 3 "${RAW}/${source}" -o "${target}.neu" || fail "${source} ließ sich nicht laden."
  mv "${target}.neu" "$target"
}

fetch_files() {
  mkdir -p "$DIR/docker"
  download docker-compose.yml "$DIR/docker-compose.yml"
  sed -i '/^[[:space:]]*build: \.$/d' "$DIR/docker-compose.yml"
  if [ -d "$DIR/docker/Caddyfile" ]; then rmdir "$DIR/docker/Caddyfile" 2>/dev/null || true; fi
  download docker/Caddyfile "$DIR/docker/Caddyfile"
  download docker/clamav.yml "$DIR/docker/clamav.yml"
}

env_set() {
  local key="$1" value="$2" file="$DIR/.env"
  touch "$file"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

install_wrapper() {
  cat >"$BIN" <<EOF
#!/bin/sh
set -e
cd "$DIR"
case "\${1:-}" in
  update)
    curl -fsSL https://moecloud.moestudio.net/install.sh | bash -s -- --update --dir "$DIR"
    ;;
  logs)
    shift
    exec docker compose logs -f --tail=200 moecloud "\$@"
    ;;
  restart)
    exec docker compose restart moecloud
    ;;
  stop)
    exec docker compose down
    ;;
  start)
    exec docker compose up -d
    ;;
  *)
    exec docker compose exec moecloud moecloud "\$@"
    ;;
esac
EOF
  chmod 755 "$BIN"
}

setup_link() {
  local link="" attempt
  for attempt in $(seq 1 60); do
    link="$(compose logs moecloud 2>/dev/null | grep -o 'https\?://[^ ]*setup?code=[A-Za-z0-9_-]*' | tail -n 1 || true)"
    [ -n "$link" ] && break
    if compose logs moecloud 2>/dev/null | grep -q 'läuft auf\|listening'; then
      if [ "$attempt" -gt 15 ]; then break; fi
    fi
    sleep 2
  done
  printf '%s' "$link"
}

ensure_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    step "Docker installieren"
    say "Docker fehlt auf diesem Server. Das offizielle Skript von get.docker.com richtet es ein."
    if [ "$YES" -eq 1 ] || confirm "Docker jetzt installieren?" "j"; then
      curl -fsSL https://get.docker.com | sh
    else
      fail "Ohne Docker geht es nicht weiter. Alternativ läuft MoeCloud direkt mit Node.js, siehe README."
    fi
  fi
  docker compose version >/dev/null 2>&1 || fail "Docker Compose fehlt. Installiere das Plugin docker-compose-plugin."
  systemctl enable --now docker >/dev/null 2>&1 || true
}

update() {
  [ -f "$DIR/docker-compose.yml" ] || fail "In $DIR liegt keine Installation. Ohne --update installierst du MoeCloud neu."
  step "MoeCloud aktualisieren"
  fetch_files
  env_set MOECLOUD_INSTALL script
  compose pull
  compose up -d --remove-orphans
  docker image prune -f >/dev/null 2>&1 || true
  install_wrapper
  done_ "MoeCloud ist aktuell. Vor dem Update hat MoeCloud die Datenbank in $DIR/data/backups gesichert."
}

install() {
  say "${bold}MoeCloud${reset} – deine Dateien auf deinem Server"
  say "Installationsordner: $DIR"
  if [ -f "$DIR/docker-compose.yml" ]; then
    say "In $DIR gibt es schon eine Installation. Sie wird aktualisiert, deine Daten bleiben."
    update
    return
  fi

  ensure_docker

  step "Einstellungen"
  if [ -z "$DOMAIN" ] && [ "$YES" -eq 0 ]; then
    DOMAIN="$(ask "Domain für HTTPS, leer lassen für Zugriff über die IP:" "")"
  fi
  DOMAIN="${DOMAIN#https://}"
  DOMAIN="${DOMAIN#http://}"
  DOMAIN="${DOMAIN%%/*}"
  if [ -n "$DOMAIN" ] && ! printf '%s' "$DOMAIN" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$'; then
    fail "Die Domain $DOMAIN ist ungültig."
  fi
  if [ -z "$DOMAIN" ] && [ -z "$PORT" ]; then PORT="$(ask "Port:" "3000")"; fi
  PORT="${PORT:-3000}"
  case "$PORT" in '' | *[!0-9]*) fail "Der Port muss eine Zahl sein." ;; esac

  local memory
  memory="$(awk '/MemTotal/ { printf "%d", $2 / 1024 }' /proc/meminfo 2>/dev/null || echo 0)"
  if [ -z "$CLAMAV" ]; then
    if [ "$YES" -eq 1 ]; then
      CLAMAV="no"
    else
      say "ClamAV prüft jede hochgeladene Datei auf Schadsoftware und braucht dafür etwa 3 GB Arbeitsspeicher."
      say "Dieser Server hat ${memory} MB."
      if confirm "ClamAV einrichten?" "$([ "$memory" -ge 3500 ] && echo j || echo n)"; then CLAMAV="yes"; else CLAMAV="no"; fi
    fi
  fi

  step "Dateien anlegen"
  mkdir -p "$DIR/data"
  fetch_files
  local timezone
  timezone="$(cat /etc/timezone 2>/dev/null || timedatectl show -p Timezone --value 2>/dev/null || echo Europe/Berlin)"
  env_set TZ "$timezone"
  env_set MOECLOUD_INSTALL script
  if [ -n "$DOMAIN" ]; then
    env_set DOMAIN "$DOMAIN"
    env_set PUBLIC_URL "https://$DOMAIN"
    env_set COMPOSE_PROFILES caddy
    env_set MOECLOUD_BIND 127.0.0.1
  else
    env_set MOECLOUD_PORT "$PORT"
  fi
  if [ "$CLAMAV" = "yes" ]; then
    env_set COMPOSE_FILE "docker-compose.yml:docker/clamav.yml"
  fi
  chmod 600 "$DIR/.env"
  chown 1000:1000 "$DIR/data"
  install_wrapper
  done_ "Konfiguration in $DIR/.env"

  step "MoeCloud starten"
  compose pull
  compose up -d
  done_ "MoeCloud läuft."

  step "Einrichtung"
  local link address
  link="$(setup_link)"
  if [ -n "$DOMAIN" ]; then
    address="https://$DOMAIN"
    link="${link/http:\/\/localhost:3000/$address}"
    say "Zeigt $DOMAIN auf diesen Server und sind die Ports 80 und 443 offen, holt Caddy das Zertifikat beim ersten Aufruf."
  else
    local ip
    ip="$(hostname -I 2>/dev/null | awk '{ print $1 }' || true)"
    address="http://${ip:-localhost}:$PORT"
    link="${link/http:\/\/localhost:3000/$address}"
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
  say "  sudo moecloud logs       Logs ansehen"
  say "  sudo moecloud update     Auf die neueste Version aktualisieren"
  say "  sudo moecloud backup     Datenbank sichern"
  say "  sudo moecloud help       Alle Befehle"
}

if [ "$MODE" = "update" ]; then
  ensure_docker
  update
else
  install
fi
