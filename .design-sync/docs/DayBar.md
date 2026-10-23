---
category: Ukeprogram
---

# DayBar

Horisontal stolpe for ett døgn, farget per modus (`.mode-comfort`, `.mode-sleep`, `.mode-away`, `.mode-normal`, `.mode-always_heating`, `.mode-off`). `min` er minutter etter midnatt.

```jsx
<div className="week-row">
  <span className="muted small">Man</span>
  <DayBar entries={[{ min: 0, mode: "sleep" }, { min: 360, mode: "comfort" }, { min: 510, mode: "away" }, { min: 960, mode: "comfort" }, { min: 1350, mode: "sleep" }]} />
</div>
```
