---
category: Oversikt
---

# Dashboard

Hele forsiden: toppfelt med husvalg og «Logg ut», husets modus, «Står på nå», rutenett med `RoomCard`, enheter uten rom, ukeprogrammer, Tibber, sammenligning Mill/Tibber, Easee og Mill-forbruk. Henter alt selv via backend (`/api/mill/*`, `/api/tibber/*`, `/api/easee/*`) og poller rom hvert minutt.

```jsx
<Dashboard user="kari@example.no" onLogout={() => {}} />
```

Bruk dette som referanse for sideoppsett: `.topbar` øverst, `<main>` (maks 1200px, `gap: 16px`) med `section.card`-seksjoner.
