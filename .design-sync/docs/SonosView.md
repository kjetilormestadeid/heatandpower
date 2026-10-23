---
category: Rom og enheter
---

# SonosView

Sonos-rom/grupper som rader (samme stil som Hue): rund play/pause-knapp, romnavn med hva som spilles («Tittel – Artist»), neste-knapp når det spilles, volum-glidebryter, og «Spill favoritt…» for rom som er stille. «Pause alt» øverst.

```jsx
<section className="card energy">
  <SonosView data={{
    householdId: "h",
    groups: [{ id: "g1", name: "Stue", players: ["Stue", "Kjøkken"], state: "playing", track: { title: "Hey Jude", artist: "The Beatles", source: "Spotify", image: null }, volume: 32, muted: false }],
    favorites: [{ id: "f1", name: "NRK P1", image: null }],
  }} onCommand={send} onVolume={setVol} onFavorite={playFav} onPauseAll={pauseAll} />
</section>
```
