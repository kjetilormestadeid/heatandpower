---
category: Oversikt
---

# ActiveNowView

Ren visning av «Står på nå»: total effekt, liste over enheter som trekker strøm (sortert, med effektstolpe), og gruppene «På, men varmer ikke nå», «Slått av» og «Frakoblet» som chips. Status avledes: frakoblet → `offline`, `isEnabled === false` → `off`, `power > 0` → `drawing`, ellers `idle`.

```jsx
<section className="card active-now">
  <ActiveNowView devices={[
    { id: "1", name: "Gulvvarme kjøkken", room: "Stue og kjøkken", type: "Sockets", power: 1520, isConnected: true, isEnabled: true },
    { id: "2", name: "Avfukter", room: null, type: "Sockets", power: 154, isConnected: true, isEnabled: true },
    { id: "3", name: "Ovn soverom", room: "Soverom", type: "Heaters", power: 0, isConnected: true, isEnabled: true },
  ]} />
</section>
```
