# design-sync notes (Heat and Power / mill-dashboard)

- This is an app, not a library: there is no `dist/` and no `.d.ts`. `.design-sync/entry.ts` is the library entry (re-exports `src/components/*`, deliberately NOT `src/main.tsx`, which mounts the app). **When a new component file is added under `src/components/`, add it to `entry.ts`, `componentSrcMap`, and `dtsPropsFor`.**
- Props are hand-written in `cfg.dtsPropsFor` (inline object types, because extraction from the app's inline prop types yields `[key: string]: unknown`). Keep them in sync with `src/types.ts` when the API types change.
- Grouping comes from `.design-sync/docs/<Name>.md` frontmatter `category` (Oversikt, Rom og enheter, Ukeprogram, Energi); the docs are the `.prompt.md` bodies.
- Data-fetching components get realistic data from `.design-sync/previews/_mock.ts` (a `window.fetch` stub with Mill/Tibber/Easee fixtures, dates relative to "today"). `_mock.ts` is NOT part of any grade key – after editing it, re-capture the containers (ActiveNow, ConsumptionCompare, DeviceList, EaseeSection, EnergyChart, Dashboard, Login, ProgramEditor, ProgramsSection, RoomCard, TibberSection, TimerPlan) and look at the sheets.
- `preview-rebuild.mjs` only recompiles previews, not `_ds_bundle.js` – after changing component code, run the full `package-build.mjs` (or the driver), otherwise previews render the old component.
- Playwright: the cached chromium is `chromium-1228` → `playwright@1.61.0` in `.ds-sync/`.
- Font: Lato via a remote Google Fonts `@import` at the top of `src/styles.css` (`[FONT_REMOTE]` is expected). Lato has only 300/400/700/900 weights; the CSS uses 300/400/700.
- `cardMode: column` for DayBar and RoomCard (they overflowed the grid cells).

## Known render warns

- none

## Re-sync risks

- `dtsPropsFor` duplicates the shapes in `src/types.ts` and component signatures – it silently goes stale when those change.
- Fixtures in `_mock.ts` mirror Mill/Tibber/Easee response shapes as of 2026-10; API shape changes are not detected by the render check.
- `server/easee.ts` reads charger status from the observations API (`/state/{serial}/observations?ids=109,120,...`, comma-separated ids); `/api/chargers/{id}/state` returns 403 for normal accounts. Observation 121 (session energy) updates rarely and can read 0 while charging.
- Dashboard's preview is one tall page cropped by the card height.

## Hue (added 2026-10-14)

- `server/hue.ts` uses the Hue Remote API: OAuth2 at `api.meethue.com/v2/oauth2/{authorize,token}` (Basic auth with client id/secret), bridge key via cloud linkbutton (`PUT /route/api/0/config`, `POST /route/api`), lights via `/route/clip/v2/resource/{light,room}`. Tokens in `data/hue.json`. Not yet verified against a real account – the token Basic-auth and route paths come from the Q42.HueApi library, not the (login-walled) official docs.
- Hue has no power metering: `hueWatts()` estimates ~9 W × brightness. ActiveNow marks these with `estimated` (≈).
- **Editing `_mock.ts` from shell scripts mangles regex escapes** (`/\/api\/…/` became `//api/…/` three times) – edit it with an editor/Edit tool only.

## Deco (added 2026-10-14)

- `server/deco.ts` ports the LuCI protocol from amosyuen/ha-tplink-deco (`api.py`): `/login?form=keys` (1024-bit RSA for the password), `/login?form=auth` (512-bit RSA sign key + seq), AES-128-CBC with 16-digit ASCII key/iv, sign = RSA(`k=…&i=…&h=md5(user+pw)&s=seq+len(data)`) in 53-byte blocks. Main Deco at 192.168.68.1 speaks this variant (not the "outer session" S7 variant). Crypto verified against the real keys; login itself not yet verified (no password in .env at time of writing). Calls are serialized – Deco dislikes parallel requests.
- Presence = device owners in `data/deco-people.json` (mac → name, lastSeen); home if seen within 15 min.

## Sonos (added 2026-10-15)

- `server/sonos.ts`: Control API at `api.ws.sonos.com/control/api/v1`, OAuth at `api.sonos.com/login/v3/oauth` (+`/access`, Basic auth). Sonos requires an HTTPS, publicly routable redirect – the app supports pasting the landed URL (`POST /api/sonos/complete`) or a forwarder that lands on `/api/sonos/callback`. `playback`, `playbackMetadata`, `groupVolume` endpoint names are from memory of the API and not yet verified against a live account.
