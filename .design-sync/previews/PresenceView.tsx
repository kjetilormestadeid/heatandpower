import { PresenceView } from 'mill-dashboard';

const now = Date.now();
const ago = (min: number) => new Date(now - min * 60_000).toISOString();
const client = (mac: string, name: string, type: string, deco: string, over = {}) => ({ mac, name, ip: '192.168.68.' + (20 + Number(mac.slice(-1))), type, wired: false, deco, down: 4, up: 1, guest: false, ...over });

const data = {
  people: [
    { name: 'Kjetil', macs: ['AA:00:00:00:00:01'], home: true, lastSeen: ago(1) },
    { name: 'Hege', macs: ['AA:00:00:00:00:02'], home: true, lastSeen: ago(3) },
    { name: 'Julie', macs: ['AA:00:00:00:00:03'], home: false, lastSeen: ago(190) },
    { name: 'Viktor', macs: ['AA:00:00:00:00:04'], home: true, lastSeen: ago(0) },
  ],
  clients: [
    client('AA:00:00:00:00:01', 'Kjetils iPhone', 'phone', 'Stue'),
    client('AA:00:00:00:00:02', 'Hege sin telefon', 'phone', 'Kjøkken'),
    client('AA:00:00:00:00:04', 'Viktor-mobil', 'phone', 'Kjeller'),
    client('AA:00:00:00:00:05', 'Samsung TV', 'tv', 'Stue', { wired: true }),
    client('AA:00:00:00:00:06', 'Hue Bridge', 'iot_device', 'Stue', { wired: true }),
    client('AA:00:00:00:00:07', 'Arbeids-PC', 'laptop', 'Kontor'),
  ],
  decos: [
    { mac: 'd1', name: 'Stue', online: true },
    { mac: 'd2', name: 'Kjøkken', online: true },
    { mac: 'd3', name: 'Kjeller', online: true },
  ],
};

export const Family = () => <section className="card energy" style={{ maxWidth: 760 }}><PresenceView data={data} onSetOwner={() => {}} /></section>;

export const NotSetUp = () => (
  <section className="card energy" style={{ maxWidth: 760 }}><PresenceView data={{ ...data, people: [] }} onSetOwner={() => {}} /></section>
);
