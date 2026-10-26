#!/data/data/com.termux/files/usr/bin/sh
# Setter opp HeatAndPower som smarthuspanel på et Android-nettbrett (Termux).
#
# Bruk (i Termux):
#   curl -fsSL https://raw.githubusercontent.com/kjetilormestadeid/heatandpower/main/scripts/setup-android.sh | sh
# eller fra en eksisterende klone:
#   sh ~/heatandpower/scripts/setup-android.sh
#
# Kan kjøres flere ganger: eksisterende klone, .env og data/ beholdes.
# Miljøvariabler:
#   HEATANDPOWER_DIR   installasjonsmappe (standard: ~/heatandpower)
#   HEATANDPOWER_REPO  git-URL (standard: GitHub-repoet)
#   HEATANDPOWER_BRANCH gren (standard: main)
set -eu

REPO_URL="${HEATANDPOWER_REPO:-https://github.com/kjetilormestadeid/heatandpower.git}"
BRANCH="${HEATANDPOWER_BRANCH:-main}"
BOOT_DIR="$HOME/.termux/boot"
BOOT_SCRIPT="$BOOT_DIR/heatandpower.sh"
FALLBACK_NODE_MIN="22.9.0"

# Exit-koder
E_ENV=10      # ikke Termux/Android
E_PKG=11      # pakkeinstallasjon feilet
E_NODE=12     # for gammel Node
E_GIT=13      # kloning feilet / mappe er ikke repoet
E_NPM=14      # npm ci feilet
E_DIST=15     # mangler ferdigbygd frontend
E_FILES=16    # kunne ikke skrive filer

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mAdvarsel:\033[0m %s\n' "$*" >&2; }
die() {
  code="$1"; shift
  printf '\033[1;31mFeil:\033[0m %s\n' "$*" >&2
  exit "$code"
}

# 1. Termux på Android?
[ "$(uname -o 2>/dev/null || true)" = "Android" ] \
  || die "$E_ENV" "Skriptet må kjøres på Android (uname -o er ikke «Android»)."
[ -n "${PREFIX:-}" ] && [ -d "$PREFIX" ] && case "$PREFIX" in *com.termux*) true ;; *) false ;; esac \
  || die "$E_ENV" "Fant ikke Termux-miljøet (\$PREFIX). Kjør skriptet i Termux-appen (F-Droid/GitHub-versjonen)."
command -v pkg >/dev/null 2>&1 || die "$E_ENV" "Fant ikke «pkg». Kjør skriptet i Termux."

# 2. Pakker
# Full oppgradering først: Termux støtter ikke delvise oppgraderinger, og ny
# nodejs mot gammel libc++ gir «CANNOT LINK EXECUTABLE node».
info "Oppgraderer Termux-pakker (pkg upgrade) …"
pkg upgrade -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold \
  || die "$E_PKG" "pkg upgrade feilet. Prøv «termux-change-repo», og kjør skriptet på nytt."

info "Installerer pakker (git, Node.js) …"
pkgs="git"
if command -v node >/dev/null 2>&1; then
  info "Node er allerede installert, hopper over Node-pakken."
else
  # nodejs-lts og nodejs er i konflikt, så vi installerer bare når node mangler
  pkgs="$pkgs nodejs-lts"
fi
# shellcheck disable=SC2086
pkg install -y $pkgs || die "$E_PKG" "pkg install feilet. Prøv «pkg update» og «termux-change-repo», og kjør skriptet på nytt."
command -v node >/dev/null 2>&1 || die "$E_PKG" "node finnes ikke etter installasjon."
node --version >/dev/null 2>&1 \
  || die "$E_PKG" "node er installert, men starter ikke (se feilen over). Kjør «pkg upgrade», og kjør skriptet på nytt."
command -v npm >/dev/null 2>&1 || die "$E_PKG" "npm finnes ikke etter installasjon."
command -v git >/dev/null 2>&1 || die "$E_PKG" "git finnes ikke etter installasjon."

# 4. Finn eller klon repoet (før Node-sjekken, som leser kravet fra package.json)
script_dir=""
case "$0" in
  *setup-android.sh) script_dir="$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)" ;;
esac
if [ -n "${HEATANDPOWER_DIR:-}" ]; then
  APP_DIR="$HEATANDPOWER_DIR"
elif [ -n "$script_dir" ] && [ -f "$script_dir/../package.json" ] && [ -f "$script_dir/start-android.sh" ]; then
  APP_DIR="$(cd "$script_dir/.." && pwd)"
else
  APP_DIR="$HOME/heatandpower"
fi

if [ -d "$APP_DIR/.git" ]; then
  info "Bruker eksisterende installasjon i $APP_DIR"
  if [ -z "$(git -C "$APP_DIR" status --porcelain --untracked-files=no)" ]; then
    git -C "$APP_DIR" pull --ff-only \
      || warn "git pull feilet – fortsetter med versjonen som allerede ligger der."
  else
    warn "Lokale endringer i $APP_DIR – hopper over git pull."
  fi
elif [ -e "$APP_DIR" ] && [ -n "$(ls -A "$APP_DIR" 2>/dev/null)" ]; then
  die "$E_GIT" "$APP_DIR finnes, men er ikke en git-klone. Flytt den eller sett HEATANDPOWER_DIR."
else
  info "Kloner $REPO_URL ($BRANCH) til $APP_DIR …"
  git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$APP_DIR" \
    || die "$E_GIT" "Kloning feilet. Er repoet privat, må du bruke et personlig tilgangstoken (HEATANDPOWER_REPO=https://<token>@github.com/…)."
fi
[ -f "$APP_DIR/package.json" ] && [ -f "$APP_DIR/scripts/start-android.sh" ] \
  || die "$E_GIT" "$APP_DIR ser ikke ut som HeatAndPower-repoet (mangler package.json eller scripts/start-android.sh)."

# 3. Node-versjon mot engines.node i package.json
node_check="$(node -e '
  const fs = require("fs");
  const want = ((JSON.parse(fs.readFileSync(process.argv[1], "utf8")).engines || {}).node || "").replace(/^>=\s*/, "") || process.argv[2];
  const parse = (v) => v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const [a, b] = [parse(process.versions.node), parse(want)];
  let ok = true;
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) { ok = a[i] > b[i]; break; } }
  console.log((ok ? "ok " : "old ") + want);
' "$APP_DIR/package.json" "$FALLBACK_NODE_MIN")" || die "$E_NODE" "Kunne ikke lese Node-kravet fra package.json."
node_min="${node_check#* }"
case "$node_check" in
  ok*) info "Node $(node --version) oppfyller kravet (>= $node_min)." ;;
  *) die "$E_NODE" "Node $(node --version) er for gammel, prosjektet krever >= $node_min. Kjør «pkg upgrade» (eller «pkg install nodejs») og prøv igjen." ;;
esac

# 5. Avhengigheter. Ingen build her: frontenden er ferdigbygd i dist/.
# Dev-avhengigheter trengs fordi serveren kjøres med tsx.
info "Installerer npm-avhengigheter (npm ci) – dette kan ta en stund på et eldre nettbrett …"
(cd "$APP_DIR" && npm ci --include=dev --no-audit --no-fund) \
  || die "$E_NPM" "npm ci feilet. Se feilmeldingen over; prøv igjen med «sh $APP_DIR/scripts/setup-android.sh»."

# 6. Ferdigbygd frontend
[ -f "$APP_DIR/dist/index.html" ] \
  || die "$E_DIST" "Fant ikke $APP_DIR/dist/index.html. Bygg frontenden på PC-en («npm run build»), sjekk inn dist/ og kjør skriptet på nytt."

# 7. .env (overskrives aldri)
if [ -f "$APP_DIR/.env" ]; then
  info ".env finnes allerede – beholdes uendret."
  env_created=0
elif [ -f "$APP_DIR/.env.example" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env" || die "$E_FILES" "Kunne ikke opprette $APP_DIR/.env."
  chmod 600 "$APP_DIR/.env"
  info "Opprettet $APP_DIR/.env fra .env.example."
  env_created=1
else
  die "$E_FILES" "Fant verken .env eller .env.example i $APP_DIR."
fi

# 8–9. Termux:Boot-skript
chmod +x "$APP_DIR/scripts/start-android.sh" "$APP_DIR/scripts/setup-android.sh" 2>/dev/null || true
mkdir -p "$BOOT_DIR" || die "$E_FILES" "Kunne ikke opprette $BOOT_DIR."
tmp="$BOOT_SCRIPT.tmp.$$"
cat > "$tmp" <<EOF || die "$E_FILES" "Kunne ikke skrive $BOOT_SCRIPT."
#!/data/data/com.termux/files/usr/bin/sh
# Generert av scripts/setup-android.sh – kjøres av Termux:Boot ved oppstart.
termux-wake-lock 2>/dev/null || true
export HEATANDPOWER_DIR="$APP_DIR"
exec sh "$APP_DIR/scripts/start-android.sh"
EOF
mv "$tmp" "$BOOT_SCRIPT" || die "$E_FILES" "Kunne ikke skrive $BOOT_SCRIPT."
chmod 700 "$BOOT_SCRIPT" || die "$E_FILES" "Kunne ikke gjøre $BOOT_SCRIPT kjørbart."
info "Oppstartsskript: $BOOT_SCRIPT"

# 10. Manuelle steg
port="$(sed -n 's/^PORT=\([0-9][0-9]*\).*/\1/p' "$APP_DIR/.env" | tail -n 1)"
port="${port:-3001}"
cat <<EOF

────────────────────────────────────────────────────────────
 HeatAndPower er installert i $APP_DIR
────────────────────────────────────────────────────────────
EOF
if [ "$env_created" = 1 ]; then
  cat <<EOF
 0. Fyll inn tokens/passord i .env:
      nano $APP_DIR/.env
    (HUE_CALLBACK_URL bør peke på http://localhost:$port/api/hue/callback)

EOF
fi
cat <<EOF
 1. Termux:Boot
    - Installer Termux:Boot fra samme kilde som Termux (F-Droid eller GitHub).
    - Åpne Termux:Boot-appen én gang, så Android lar den starte ved oppstart.
    - Android-innstillinger → Apper → Termux og Termux:Boot → Batteri:
      «Ubegrenset» / slå av batterioptimalisering.

 2. Test uten omstart:
      sh $APP_DIR/scripts/start-android.sh &
      tail -f ~/heatandpower.log
    Åpne http://localhost:$port i nettleseren. Stopp med:
      kill \$(cat ~/.heatandpower.pid)

 3. Fully Kiosk Browser
    - Start URL: http://localhost:$port
    - Web Content Settings → «Autoreload on Network Reconnect» / «Reload on
      Page Error» (serveren bruker noen sekunder på å starte etter omstart).
    - Device Management → «Launch on Boot» og «Keep Screen On».
    - Kiosk Mode → aktiver når alt fungerer.

 4. Start nettbrettet på nytt og sjekk at panelet kommer opp av seg selv.

 Oppdatering: serveren henter ny kode fra git selv (hvert 10. min, endres med
 HEATANDPOWER_UPDATE_INTERVAL i sekunder, 0 = av). Kjør dette skriptet på nytt
 hvis noe må settes opp på nytt.
EOF
