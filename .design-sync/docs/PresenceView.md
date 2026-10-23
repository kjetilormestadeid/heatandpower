---
category: Oversikt
---

# PresenceView

«Hvem er hjemme»: personer som avatar-chips (grønn = hjemme, dempet = borte med «sist sett»), nøkkeltall, og en utvidbar liste over enheter på Deco-nettet der hver enhet kan kobles til en person. En person regnes som hjemme hvis en av enhetene er sett de siste 15 minuttene.

```jsx
<section className="card energy">
  <PresenceView data={{
    people: [
      { name: "Kjetil", macs: ["AA:BB:CC:00:00:01"], home: true, lastSeen: new Date().toISOString() },
      { name: "Hege", macs: ["AA:BB:CC:00:00:02"], home: false, lastSeen: "2026-10-14T16:05:00Z" },
    ],
    clients: [{ mac: "AA:BB:CC:00:00:01", name: "Kjetils iPhone", ip: "192.168.68.20", type: "phone", wired: false, deco: "Stue", down: 12, up: 3, guest: false }],
    decos: [{ mac: "x", name: "Stue", online: true }],
  }} onSetOwner={(c, name) => save(c, name)} />
</section>
```
