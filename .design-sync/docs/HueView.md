---
category: Rom og enheter
---

# HueView

Ren visning av Philips Hue-lamper: nøkkeltall (lamper på, estimert effekt) og lamper gruppert per rom med på/av-bryter (`.switch`) og lysstyrke. Hue måler ikke strøm; effekten er et estimat (~9 W ved full styrke, skalert med dimming).

```jsx
<section className="card energy">
  <HueView lights={[
    { id: "1", name: "Taklampe", room: "Stue", on: true, brightness: 80 },
    { id: "2", name: "Leselampe", room: "Stue", on: false, brightness: 100 },
    { id: "3", name: "Nattbord", room: "Soverom", on: true, brightness: 20 },
  ]} onToggle={(l) => toggle(l)} />
</section>
```
