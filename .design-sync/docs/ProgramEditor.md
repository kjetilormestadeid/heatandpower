---
category: Ukeprogram
---

# ProgramEditor

Redigering av et ukeprogram: navn, legende, én rad per dag med `DayBar`; åpen dag viser tidspunkt + modus, «Legg til tidspunkt» og «Kopier til: Hverdager / Helg / Alle». «Lagre» sender til Mill-API.

```jsx
<div className="card"><ProgramEditor program={program} onSaved={reload} onClose={() => setEditing(null)} /></div>
```
