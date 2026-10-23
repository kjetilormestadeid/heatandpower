#!/data/data/com.termux/files/usr/bin/sh
# Starter HeatAndPower-serveren på nettbrettet og holder den i gang.
# Kalles av ~/.termux/boot/heatandpower.sh (laget av setup-android.sh), men kan
# også kjøres manuelt. Stopp med: kill $(cat ~/.heatandpower.pid)
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

log() { printf '%s [start-android] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE"; }
die() { log "FEIL: $*"; printf 'Feil: %s\n' "$*" >&2; exit 1; }

[ -f "$APP_DIR/package.json" ] || die "Fant ikke HeatAndPower i $APP_DIR (sett HEATANDPOWER_DIR)."
[ -f "$APP_DIR/.env" ] || die "Mangler $APP_DIR/.env – kjør scripts/setup-android.sh først."
[ -f "$APP_DIR/dist/index.html" ] || die "Mangler $APP_DIR/dist/index.html."
TSX="$APP_DIR/node_modules/.bin/tsx"
[ -x "$TSX" ] || die "Fant ikke tsx – kjør scripts/setup-android.sh (npm ci) først."

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

while [ "$stopping" = 0 ]; do
  rotate_log
  log "Starter server (PID-fil $PID_FILE) …"
  # Tilsvarer «npm start», men uten npm som mellomledd så signaler når fram
  set +e
  "$TSX" --env-file-if-exists=.env server/index.ts >> "$LOG_FILE" 2>&1 &
  child=$!
  wait "$child"
  status=$?
  set -e
  child=""
  [ "$stopping" = 1 ] && break
  log "Serveren avsluttet uventet (kode $status). Ny start om ${RESTART_DELAY} s."
  # sleep i bakgrunnen + wait, så TERM/INT avbryter pausen med en gang
  sleep "$RESTART_DELAY" &
  wait $! 2>/dev/null || true
done
