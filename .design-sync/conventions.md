# Heat and Power – conventions

Norwegian (nb-NO) home-energy dashboard: Mill heaters, Tibber prices/consumption, Easee EV charging. All UI text is Norwegian; format numbers with `toLocaleString('nb-NO')` (`21,4°`, `1 050 kWh`, `7,2 kW`, `94 øre`).

## Setup

No provider or wrapper. Link `styles.css` (tokens, Lato from Google Fonts, all component classes) and the bundle; components read only CSS custom properties. Light/dark follow `prefers-color-scheme`; force light with `<html data-theme="light">`.

**Pure views render from props – use these in designs:** `BarChart`, `CompareView`, `ActiveNowView`, `ChargerView`, `DayBar`, `ModeLegend`, `RoomCard` (saves via API only on interaction). **Containers fetch from the app backend** (`/api/mill/*`, `/api/tibber/*`, `/api/easee/*`) and show "Henter…" without it: `Dashboard`, `ActiveNow`, `ConsumptionCompare`, `EaseeSection`, `TibberSection`, `EnergyChart`, `DeviceList`, `TimerPlan`, `ProgramsSection`. In a design, compose the pure view with realistic data instead.

## Styling idiom: global classes + CSS variables

No CSS-in-JS, no utility framework. Use these class names for your own layout glue; colors only via `var(--*)`.

| Purpose | Classes |
|---|---|
| Page | `.topbar` > `.brand`, `.spacer`; `<main>` (max 1200px, column, gap 16px) |
| Section | `section.card` (+ `.energy` / `.room` / `.programs` / `.active-now` for column gap), `.section-head` (h2 + `.spacer` + actions) |
| Grids | `.grid` (cards, min 300px), `.tiles` > `.tile` (`span.muted.small` label + `strong` value) |
| Text | `.muted`, `.small`, `.error`, `.error.banner` |
| Icons | `Icon` component (`name="flame"`, `droplet`, `bolt`, `pencil`, `close`, `plus`, `minus`, `chevron-left`/`right`, `thermometer`, `window`, `plug`) – never emoji; `.with-icon` aligns icon + text |
| Status | `.pill` (+ `.heat`, `.warn`, `.on`), `.level-CHEAP` … `.level-VERY_EXPENSIVE`, `.dot.on` / `.dot.off`, `.chip` in `.chips` |
| Controls | `button` (default outline), `button.primary`, `button.link`, `button.icon`, `.seg` (button row), `.seg-toggle` > `button.selected`, `.stepper`, `label.switch` > `input[type=checkbox]` + `span` |
| Legend | `.legend` > `span` > `i.swatch` (+ `.mode-comfort` etc. or inline `background: var(--series-1)`) |
| Data | `table.data`, `.power-bar` > `span` (width %) |

Tokens: `--bg`, `--surface`, `--border`, `--text`, `--text-2`, `--muted`, `--accent`, `--accent-ink`, `--series-1`, `--series-2`, `--heat`, `--heat-bg`, `--warn`, `--warn-bg`, `--error`, `--ok`, `--radius` (12px), program modes `--mode-comfort`, `--mode-sleep`, `--mode-away`, `--mode-normal`, `--mode-always_heating`, `--mode-off`. Font weights: 300 (big numbers `.big`), 400, 700 – Lato has no 500/600.

## Where the truth lives

`styles.css` → `_ds_bundle.css` holds every class above; read it before styling. Per-component usage and props: `components/<group>/<Name>/<Name>.prompt.md` and `<Name>.d.ts` (groups: oversikt, rom-og-enheter, ukeprogram, energi).

## Example

```jsx
const { ActiveNowView, BarChart } = window.HeatAndPower;

<main>
  <div className="section-head">
    <h2>Hytta på Geilo</h2>
    <span className="pill">Ukeprogram</span>
    <div className="spacer" />
    <button>Oppdater</button>
  </div>
  <section className="card active-now">
    <ActiveNowView devices={[
      { id: '1', name: 'Gulvvarme kjøkken', room: 'Stue og kjøkken', type: 'Sockets', power: 1520, isConnected: true, isEnabled: true },
      { id: '2', name: 'Avfukter', room: null, type: 'Sockets', power: 154, isConnected: true, isEnabled: true },
    ]} />
  </section>
  <section className="card energy">
    <h2>Strømpris i dag</h2>
    <BarChart label="Strømpris" unit="øre" formatAxis={(v) => String(Math.round(v * 100))}
      bars={[0.62, 0.58, 1.42, 1.82].map((v, h) => ({ key: String(h), value: v, tooltip: <strong>{Math.round(v * 100)} øre</strong> }))} />
  </section>
</main>
```
