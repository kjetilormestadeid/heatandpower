# Mill Oversikt

Egen nettside for Mill-ovner via [Mill Norway API](http://mn-be-prod-documentation.s3-website.eu-central-1.amazonaws.com/#/).

- **Frontend:** Vite + React + TypeScript (`src/`)
- **Backend:** Node + Express (`server/`) – logger inn mot Mill, holder tokens server-side
  (httpOnly-cookie mot nettleseren), fornyer token automatisk og proxyer `/api/mill/*` → `https://api.millnorwaycloud.com/*`.

## Kom i gang

```bash
npm install
cp .env.example .env
npm run dev          # backend på :3001, Vite på http://localhost:5173
```

Produksjon: `npm run build && npm start` (Express serverer `dist/` på `PORT`).

## Funksjoner

- Innlogging med Mill-konto (e-post/telefon + passord)
- Velg hus (egne og delte)
- Rom: nåtemperatur, fuktighet, varmestatus, åpent vindu, modus/ukeprogram
- Juster komfort-/natt-/bortetemperatur (0,5° steg)
- Overstyr rommodus (1/3/8 timer eller til avbrutt), avbryt overstyring
- Enhetsliste per rom med på/av-bryter, effekt og dagens forbruk
- Strømforbruk per dag for valgt måned, kostnad og fordeling per rom
- Gi rom nytt navn, velg ukeprogram per rom, rediger ukeprogrammer
- Tidsplaner (av/på-timere) for enheter uten rom, f.eks. stikkontakter
- Tibber: strømpris nå/i dag/i morgen (time eller 15 min), billigste periode fremover, forbruk og kostnad siste 30 dager

## Tibber

Lag et personlig token på https://developer.tibber.com/settings/access-token og legg det i `.env`:

```
TIBBER_TOKEN=...
```

Tokenet blir på serveren; nettleseren får bare data, og kun når man er innlogget med Mill.

## Merknader

- Mill tillater 2500 kall/time per kunde. Backenden cacher GET i 10 sek, og frontenden poller rom hvert minutt (bare når fanen er synlig).
- Refresh-token kan bare brukes én gang; sesjoner lagres i `data/sessions.json` så de overlever omstart. Ikke sjekk inn denne mappen.
- Konto-/auth-endepunkter (slett konto, bytt passord osv.) er blokkert i proxyen.
- Sett `COOKIE_SECURE=true` når siten kjører bak HTTPS.

## Android-nettbrett (Termux)

Kjør serveren og den ferdigbygde frontenden (`dist/`, sjekket inn) lokalt på et nettbrett, med autostart via Termux:Boot:

```sh
pkg install -y git && git clone https://github.com/kjetilormestadeid/heatandpower.git ~/heatandpower
sh ~/heatandpower/scripts/setup-android.sh
```

Skriptet kan kjøres på nytt for å oppdatere. Logg: `~/heatandpower.log`. Stopp: `kill $(cat ~/.heatandpower.pid)`.
Nettbrettet ser etter ny kode i git hvert 10. minutt (`HEATANDPOWER_UPDATE_INTERVAL` i sekunder, `0` slår det av), henter den, kjører `npm ci` ved endrede avhengigheter og starter serveren på nytt. Husk derfor `npm run build` og å sjekke inn `dist/` før du pusher.
