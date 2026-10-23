---
category: Energi
---

# CompareView

Ren visning av sammenligningen: nøkkeltall (hele huset, Mill-ovner, Mill-andel, estimert Mill-kostnad), legende og stablet søylegraf per dag (Mill = `--series-1`, resten = `--series-2`).

```jsx
<section className="card energy">
  <CompareView days={[
    { key: "2026-10-13", date: new Date(2026, 9, 13), total: 34.2, mill: 16.1, unitPrice: 1.12 },
    { key: "2026-10-14", date: new Date(2026, 9, 14), total: 38.9, mill: 19.4, unitPrice: 1.31 },
  ]} />
</section>
```
