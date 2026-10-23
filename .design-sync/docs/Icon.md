---
category: Oversikt
---

# Icon

Minimalistiske strek-ikoner (SVG 24×24, strek 1,75, `currentColor`). Størrelsen følger `font-size` (1em), så ikonet arver farge og størrelse fra teksten rundt. Bruk disse i stedet for emoji.

Navn: `flame` (varmer), `droplet` (fuktighet), `bolt` (lader), `pencil` (gi nytt navn), `close` (fjern), `minus`, `plus`, `chevron-left`, `chevron-right`, `thermometer`, `window` (åpent vindu), `plug` (stikkontakt).

```jsx
<span className="pill heat"><Icon name="flame" /> Varmer</span>
<span className="with-icon"><Icon name="droplet" /> 38 %</span>
<button className="icon" aria-label="Gi nytt navn"><Icon name="pencil" /></button>
```
