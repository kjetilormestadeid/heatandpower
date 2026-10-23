---
category: Rom og enheter
---

# RoomCard

Kort for ett rom: navn (kan endres), status-piller (`Varmer`, `Åpent vindu`, `Frakoblet`), nåtemperatur, fuktighet, modus, steppere for Komfort/Natt/Borte (0,5° steg), valg av ukeprogram, overstyring (1/3/8 t / til avbrutt) og «Vis enheter». Lagrer endringer mot Mill-API og kaller `onChanged`. Legg flere i `.grid`.

```jsx
<div className="grid">
  {rooms.map((r) => <RoomCard key={r.id} room={r} programs={programs} onChanged={reload} />)}
</div>
```
