---
category: Energi
---

# EnergySumView

Sum-graf for i dag: stablede søyler per time der hele husets forbruk (Tibber) er fordelt på Mill-ovner (`--series-1`), elbil (`--series-3`) og annet (`--series-2`, = Tibber minus resten). Nøkkeltall med kWh og andel. Timer Tibber ikke har levert ennå vises dempet med bare Mill og elbil.

```jsx
<section className="card energy">
  <EnergySumView hours={[
    { hour: 0, total: 8.9, mill: 0.1, ev: 3.1 },
    { hour: 1, total: 7.6, mill: 0.1, ev: 4.5 },
    { hour: 2, total: 3.4, mill: 0.1, ev: 0 },
  ]} />
</section>
```
