---
category: Rom og enheter
---

# DeviceList

Liste over enheter i et rom (`source={{ roomId }}`) eller enheter uten rom (`source={{ houseId }}`): tilkoblet-prikk, navn, temperatur/effekt/forbruk i dag, på/av-bryter (`.switch`) og «Tidsplan» som åpner `TimerPlan`. Henter selv.

```jsx
<section className="card room">
  <div className="room-head"><h3>Enheter uten rom</h3></div>
  <DeviceList source={{ houseId }} onMoved={reload} />
</section>
```
