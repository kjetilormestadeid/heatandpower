---
category: Energi
---

# ChargerView

Ren visning av én Easee-lader: status-pill (Lader / Klar til lading / Ingen bil tilkoblet / Feil …), effekt nå, energi i økten, ladet i dag, strøm til bilen, knapper (Pause/Stopp eller Start lading) og søyler per time for hele døgnet.

```jsx
<section className="card energy">
  <div className="charger">
    <ChargerView name="Garasje" onCommand={(cmd) => send(cmd)} data={{
      state: { chargerOpMode: 3, totalPower: 7.2, sessionEnergy: 14.8, outputCurrent: 10.4, dynamicChargerCurrent: 32, cableLocked: true, isOnline: true, latestPulse: null },
      hourly: [],
    }} />
  </div>
</section>
```
