import { DiagnosticsView } from 'mill-dashboard';

const dev = (name: string, model: string, room: string, verdict: 'ok' | 'cloud' | 'nowifi' | 'unknown', hint: string, wifi: string | null, millConnected = true) => ({
  id: name, name, model, type: 'Heaters', house: 'Hjemme', room, mac: null, millConnected,
  wifi: wifi ? { ip: wifi, band: '2.4', deco: null, guest: false } : null, verdict, hint,
});

const data = {
  checkedAt: new Date().toISOString(),
  devices: [
    dev('gulvvarme kjøkken', 'GL-WIFI Socket G4', 'Stue og kjøkken', 'nowifi', 'Verken på wifi eller i Mill-skyen – ovnen er av, utenfor rekkevidde eller har mistet wifi-oppsettet', null, false),
    dev('soverom', 'GL-Panel Heater G2', 'Soverom', 'cloud', 'På wifi, men får ikke kontakt med Mill-skyen – prøv å skru ovnen av/på', '192.168.68.90', false),
    dev('julie', 'GL-Panel Heater G2', 'Julies rom', 'ok', 'Gen 2: tilkoblet Mill, men MAC-en fra Mill finnes ikke på wifi (normalt for Gen 2). Er sannsynligvis «HF-LPT230» (192.168.68.62) på wifi.', null),
    dev('panelovn kjeller', 'GL-Panel Heater G3', 'Kjeller', 'ok', 'På wifi og tilkoblet Mill', '192.168.68.77'),
  ],
  candidates: [{ mac: '00:23:38:43:74:4A', name: 'HF-LPT230', ip: '192.168.68.62', band: '2.4', deco: null, reason: 'Wifi-modul «HF-LPT230» – typisk i eldre (Gen 1/2) wifi-ovner. Test: skru av ovnen på veggen og se om denne forsvinner.' }],
  deco: {
    clients: 29,
    units: [
      { mac: 'a', name: 'viktor', online: true, model: 'X60', firmware: '1.6.1 Build 20250912', role: 'master' },
      { mac: 'b', name: 'vedbod', online: true, model: 'X60', firmware: '1.6.1 Build 20250912', role: 'slave' },
      { mac: 'c', name: 'Deco_A2C8', online: false, model: 'X60', firmware: null, role: 'slave' },
    ],
  },
  decoError: null,
};

export const Result = () => <section className="card energy" style={{ maxWidth: 820 }}><DiagnosticsView data={data} /></section>;
