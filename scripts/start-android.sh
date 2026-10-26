#!/data/data/com.termux/files/usr/bin/sh
# Starter HeatAndPower-serveren på nettbrettet og holder den i gang.
# Kalles av ~/.termux/boot/heatandpower.sh (laget av setup-android.sh), men kan
# også kjøres manuelt. Stopp med: kill $(cat ~/.heatandpower.pid)
#
# Ser etter ny kode i git hvert HEATANDPOWER_UPDATE_INTERVAL sekund (standard
# 600, 0 slår det av). Finnes det nye commits på upstream-grenen, hentes de
# (fast-forward), npm ci kjøres hvis avhengighetene er endret, og serveren
# startes på nytt. Lokale endringer i repoet gjør at oppdateringen hoppes over.
set -eu

# Repo-mappen: HEATANDPOWER_DIR, ellers mappen over dette skriptet
if [ -n "${HEATANDPOWER_DIR:-}" ]; then
  APP_DIR="$HEATANDPOWER_DIR"
else
  APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
fi
LOG_FILE="$HOME/heatandpower.log"
PID_FILE="$HOME/.heatandpower.pid"
LOG_MAX_BYTES=5242880   # roter loggen ved 5 MB
RESTART_DELAY=10
UPDATE_INTERVAL="${HEATANDPOWER_UPDATE_INTERVAL:-600}"
case "$UPDATE_INTERVAL" in ''|*[!0-9]*) UPDATE_INTERVAL=600 ;; esac

log() { printf '%s [start-android] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE"; }
die() { log "FEIL: $*"; printf 'Feil: %s\n' "$*" >&2; exit 1; }

[ -f "$APP_DIR/package.json" ] || die "Fant ikke HeatAndPower i $APP_DIR (sett HEATANDPOWER_DIR)."
[ -f "$APP_DIR/.env" ] || die "Mangler $APP_DIR/.env – kjør scripts/setup-android.sh først."
[ -f "$APP_DIR/dist/index.html" ] || die "Mangler $APP_DIR/dist/index.html."
# tsx kjøres med node direkte: shebangen «#!/usr/bin/env node» virker bare når
# termux-exec er lastet, og det er den ikke når Termux:Boot starter skriptet.
TSX="$APP_DIR/node_modules/tsx/dist/cli.mjs"
[ -f "$TSX" ] || die "Fant ikke tsx – kjør scripts/setup-android.sh (npm ci) først."
command -v node >/dev/null 2>&1 || die "Fant ikke node i PATH ($PATH)."

# Én instans: PID-fila opprettes atomisk (noclobber). Ligger det en gammel fil
# etter krasj/strømbrudd, ryddes den bort.
acquire_lock() {
  ( set -C; echo "$$" > "$PID_FILE" ) 2>/dev/null
}
if ! acquire_lock; then
  old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null \
     && grep -q 'start-android' "/proc/$old_pid/cmdline" 2>/dev/null; then
    echo "HeatAndPower kjører allerede (PID $old_pid)."
    exit 0
  fi
  rm -f "$PID_FILE"
  acquire_lock || die "Kunne ikke opprette $PID_FILE (startes en annen instans akkurat nå?)."
fi

child=""
stopping=0
cleanup() {
  [ "$(cat "$PID_FILE" 2>/dev/null || true)" = "$$" ] && rm -f "$PID_FILE"
  command -v termux-wake-unlock >/dev/null 2>&1 && termux-wake-unlock 2>/dev/null || true
}
on_signal() {
  stopping=1
  log "Stoppsignal mottatt, avslutter serveren …"
  if [ -n "$child" ] && kill -0 "$child" 2>/dev/null; then
    kill -TERM "$child" 2>/dev/null || true
    wait "$child" 2>/dev/null || true
  fi
  cleanup
  log "Stoppet."
  exit 0
}
trap on_signal TERM INT HUP
trap cleanup EXIT

command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock 2>/dev/null || true

rotate_log() {
  [ -f "$LOG_FILE" ] || return 0
  size="$(wc -c < "$LOG_FILE" 2>/dev/null || echo 0)"
  [ "$size" -gt "$LOG_MAX_BYTES" ] && mv -f "$LOG_FILE" "$LOG_FILE.1" || true
}

cd "$APP_DIR"   # serveren finner dist/ og data/ relativt til arbeidsmappen
export NODE_ENV=production
export GIT_TERMINAL_PROMPT=0   # git fetch skal feile, ikke henge på passordspørsmål

next_check=$(( $(date +%s) + UPDATE_INTERVAL ))
new_rev=""
skip_rev=""   # commit som feilet eller ikke kan spoles fram til; prøves ikke igjen
updating=0

# Er det på tide å se etter ny kode? Flytter i så fall neste sjekk fram.
update_due() {
  [ "$UPDATE_INTERVAL" -gt 0 ] && [ -d .git ] && [ "$(date +%s)" -ge "$next_check" ] || return 1
  next_check=$(( $(date +%s) + UPDATE_INTERVAL ))
}

# Henter fra git. Lykkes bare når upstream har nye commits som HEAD kan spoles
# fram til uten å røre lokale endringer. Setter new_rev.
update_available() {
  git fetch --quiet >> "$LOG_FILE" 2>&1 || { log "git fetch feilet – prøver igjen om ${UPDATE_INTERVAL} s."; return 1; }
  new_rev="$(git rev-parse --short '@{u}' 2>/dev/null)" || { log "Grenen har ingen upstream – kan ikke se etter oppdateringer."; return 1; }
  [ "$(git rev-parse --short HEAD)" = "$new_rev" ] && return 1
  [ "$new_rev" = "$skip_rev" ] && return 1
  skip_rev="$new_rev"
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    log "Ny kode ($new_rev), men lokale endringer i $APP_DIR – hopper over oppdateringen."
    return 1
  fi
  if ! git merge-base --is-ancestor HEAD '@{u}' 2>/dev/null; then
    log "Ny kode ($new_rev), men lokal gren har avvikende commits – hopper over oppdateringen."
    return 1
  fi
  skip_rev=""
}

# Spoler fram til upstream (serveren må være stoppet). Feiler npm ci, rulles det
# tilbake til forrige versjon, og new_rev hoppes over til neste push.
apply_update() {
  old_rev="$(git rev-parse HEAD)"
  if ! git merge --ff-only --quiet '@{u}' >> "$LOG_FILE" 2>&1; then
    log "git merge feilet – beholder $(git rev-parse --short HEAD)."
    skip_rev="$new_rev"
    return 0
  fi
  if ! git diff --quiet "$old_rev" HEAD -- package.json package-lock.json; then
    log "Avhengighetene er endret – kjører npm ci …"
    if ! npm ci --include=dev --no-audit --no-fund >> "$LOG_FILE" 2>&1; then
      log "npm ci feilet – ruller tilbake til $(git rev-parse --short "$old_rev")."
      skip_rev="$new_rev"
      git reset --quiet --hard "$old_rev" >> "$LOG_FILE" 2>&1 || true
      npm ci --include=dev --no-audit --no-fund >> "$LOG_FILE" 2>&1 \
        || log "npm ci feilet også for forrige versjon – kjør scripts/setup-android.sh."
      return 0
    fi
  fi
  log "Oppdatert til $new_rev."
  if ! git diff --quiet "$old_rev" HEAD -- scripts/start-android.sh; then
    # Samme PID, så låsen frigjøres først. exec kjører ikke EXIT-trap.
    log "start-android.sh er endret – starter skriptet på nytt."
    rm -f "$PID_FILE"
    export HEATANDPOWER_DIR="$APP_DIR"
    exec sh "$APP_DIR/scripts/start-android.sh"
  fi
}

# Venter til serveren avslutter, og ser etter ny kode underveis. Er det ny
# kode, stoppes serveren og updating settes. Returnerer serverens exit-kode.
wait_child() {
  while kill -0 "$child" 2>/dev/null; do
    sleep 5 &
    wait $! 2>/dev/null || true
    if update_due && update_available; then
      log "Ny kode ($new_rev) – stopper serveren for oppdatering …"
      updating=1
      kill -TERM "$child" 2>/dev/null || true
      break
    fi
  done
  wait "$child"
}

while [ "$stopping" = 0 ]; do
  rotate_log
  log "Starter server (PID-fil $PID_FILE) …"
  # Tilsvarer «npm start», men uten npm som mellomledd så signaler når fram
  set +e
  node "$TSX" --env-file-if-exists=.env server/index.ts >> "$LOG_FILE" 2>&1 &
  child=$!
  wait_child
  status=$?
  set -e
  child=""
  [ "$stopping" = 1 ] && break
  if [ "$updating" = 1 ]; then
    updating=0
    apply_update
    continue
  fi
  log "Serveren avsluttet uventet (kode $status). Ny start om ${RESTART_DELAY} s."
  # sleep i bakgrunnen + wait, så TERM/INT avbryter pausen med en gang
  sleep "$RESTART_DELAY" &
  wait $! 2>/dev/null || true
  # Krasjer serveren i loop, kan en retting allerede ligge i git
  if update_due && update_available; then
    apply_update
  fi
done
