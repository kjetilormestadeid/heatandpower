---
category: Energi
---

# BarChart

Generell søylegraf (SVG, én serie) med rundet topp, rutenett, akse-etiketter, hover-tooltip og valgfri stiplet skillelinje. `state: "past"` dempes, `"current"` fremheves. Fyller bredden av forelderen.

```jsx
<BarChart
  label="Strømpris i dag" unit="øre"
  formatAxis={(v) => String(Math.round(v * 100))}
  bars={prices.map((p, h) => ({ key: String(h), value: p, tick: h % 3 === 0 ? String(h).padStart(2, "0") : undefined, tooltip: <strong>{Math.round(p * 100)} øre</strong> }))}
/>
```
