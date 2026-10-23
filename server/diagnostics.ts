// Feilsøking: sammenligner Mill-enhetene (skyen) med det Deco ser på wifi, og leter etter
// ovner som er på nettet men ikke registrert i Mill (typisk halvveis parede Gen 2-ovner).
import { decoConfigured, decoOverview } from './deco.ts';
import { millRequest } from './mill.ts';

const normMac = (m: string | null | undefined) => (m ? m.toUpperCase().replace(/-/g, ':') : null);
const oui = (m: string) => m.slice(0, 8);

/** Wifi-moduler brukt i eldre (Gen 1/2) wifi-ovner – navnet de ofte melder seg med på nettet. */
const LEGACY_MODULE = /^(HF-LP[A-Z0-9]+|HF-A11|USR-WIFI)/i;

interface MillDevice {
  deviceId: string;
  macAddress: string | null;
  customName: string | null;
  isConnected: boolean;
  isEnabled: boolean | null;
  deviceType: { childType: { name: string }; parentType: { name: string } };
  lastMetrics: { currentPower?: number } | null;
}

export interface MillDiag {
  id: string;
  name: string;
  model: string;
  type: string;
  house: string;
  room: string;
  mac: string | null;
  millConnected: boolean;
  wifi: { ip: string | null; band: string | null; deco: string | null; guest: boolean } | null;
  verdict: 'ok' | 'cloud' | 'nowifi' | 'offline' | 'unknown';
  hint: string;
}

export interface Candidate {
  mac: string;
  name: string;
  ip: string | null;
  band: string | null;
  deco: string | null;
  reason: string;
}

async function mill<T>(sid: string, p: string): Promise<T> {
  const r = await millRequest(sid, 'GET', p);
  if (r.status >= 400) throw new Error(`Mill svarte ${r.status}`);
  return r.data as T;
}

export async function millNetworkDiagnostics(sid: string) {
  // 1. Alle Mill-enheter på kontoen
  const houses = await mill<{ ownHouses: { id: string; name: string }[]; sharedHouses: { house: { id: string; name: string } }[] }>(sid, '/houses');
  const devices: { d: MillDevice; house: string; room: string }[] = [];
  for (const h of [...houses.ownHouses, ...houses.sharedHouses.map((s) => s.house)]) {
    const { rooms } = await mill<{ rooms: { id: string; name: string }[] }>(sid, `/houses/${h.id}/rooms`);
    for (const r of rooms) {
      const { devices: list } = await mill<{ devices: MillDevice[] }>(sid, `/rooms/${r.id}/devices`);
      for (const d of list) devices.push({ d, house: h.name.trim(), room: r.name.trim() });
    }
    const ind = await mill<{ items: MillDevice[] }>(sid, `/houses/${h.id}/devices/independent?filterDevices=allDevice`);
    for (const d of ind.items) devices.push({ d, house: h.name.trim(), room: 'Uten rom' });
  }

  // 2. Hva Deco ser på wifi (valgfritt)
  let deco: Awaited<ReturnType<typeof decoOverview>> | null = null;
  let decoError: string | null = null;
  if (decoConfigured()) {
    try {
      deco = await decoOverview();
    } catch (err) {
      decoError = err instanceof Error ? err.message : 'Deco utilgjengelig';
    }
  }
  const clients = (deco?.clients ?? []).map((c) => ({ ...c, mac: normMac(c.mac)! }));
  const byMac = new Map(clients.map((c) => [c.mac, c]));

  // 3. Vurder hver Mill-enhet
  const result: MillDiag[] = devices.map(({ d, house, room }) => {
    const mac = normMac(d.macAddress);
    const c = mac ? byMac.get(mac) : undefined;
    const wifi = c ? { ip: c.ip, band: c.band, deco: c.deco, guest: c.guest } : null;
    let verdict: MillDiag['verdict'];
    let hint: string;
    if (!deco) {
      verdict = d.isConnected ? 'ok' : 'offline';
      hint = d.isConnected ? 'Tilkoblet Mill-skyen' : 'Frakoblet fra Mill-skyen (Deco ikke tilgjengelig for wifi-sjekk)';
    } else if (d.isConnected && c) {
      verdict = 'ok';
      hint = 'På wifi og tilkoblet Mill';
    } else if (d.isConnected && !c) {
      verdict = 'unknown';
      hint = 'Tilkoblet Mill, men ikke i Deco-listen nå (kan sove, være på et annet nett eller gjestenett)';
    } else if (!d.isConnected && c) {
      verdict = 'cloud';
      hint = 'På wifi, men får ikke kontakt med Mill-skyen – prøv å skru ovnen av/på, sjekk at nettet har internett';
    } else {
      verdict = 'nowifi';
      hint = 'Verken på wifi eller i Mill-skyen – ovnen er av, utenfor rekkevidde eller har mistet wifi-oppsettet';
    }
    return {
      id: d.deviceId,
      name: (d.customName || d.deviceType.childType.name).trim(),
      model: d.deviceType.childType.name,
      type: d.deviceType.parentType.name,
      house,
      room,
      mac,
      millConnected: d.isConnected,
      wifi,
      verdict,
      hint,
    };
  });

  // 4. Kandidater: på nettet, ser ut som en ovn, men ikke i Mill
  const known = new Set(result.map((r) => r.mac).filter(Boolean));
  const millOuis = new Set([...known].map((m) => oui(m!)));
  const candidates: Candidate[] = clients
    .filter((c) => !known.has(c.mac))
    .flatMap((c) => {
      const reason = LEGACY_MODULE.test(c.name)
        ? `Wifi-modul «${c.name}» – typisk i eldre (Gen 1/2) wifi-ovner`
        : /mill/i.test(c.name)
          ? 'Navnet inneholder «mill»'
          : millOuis.has(oui(c.mac))
            ? 'Samme MAC-prefiks (produsent) som Mill-enhetene dine'
            : null;
      return reason ? [{ mac: c.mac, name: c.name, ip: c.ip, band: c.band, deco: c.deco, reason }] : [];
    });

  // 5. Gen 2-ovner melder en annen MAC til Mill enn wifi-modulen bruker – koble «tilkoblet, men ikke funnet på wifi»
  // Gen 2-ovner sammen med Hi-Flying-kandidatene, så en allerede registrert ovn ikke ser ut som en ny.
  const unmatchedG2 = result.filter((r) => /G2/.test(r.model) && r.millConnected && !r.wifi);
  const legacy = candidates.filter((c) => LEGACY_MODULE.test(c.name));
  if (unmatchedG2.length && legacy.length) {
    const names = unmatchedG2.map((r) => `«${r.name}»`).join(' eller ');
    for (const c of legacy) c.reason += `. Kan være en allerede registrert Gen 2-ovn (${names}) – Gen 2 melder en annen MAC til Mill enn wifi-modulen bruker. Test: skru av ovnen på veggen og se om denne forsvinner.`;
    for (const r of unmatchedG2) {
      r.hint = `Gen 2: tilkoblet Mill, men MAC-en fra Mill finnes ikke på wifi (normalt for Gen 2). Er sannsynligvis ${legacy.map((c) => `«${c.name}» (${c.ip})`).join(' / ')} på wifi.`;
      r.verdict = 'ok';
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    devices: result.sort((a, b) => a.verdict.localeCompare(b.verdict) || a.name.localeCompare(b.name, 'nb')),
    candidates,
    deco: deco ? { clients: clients.length, units: deco.decos } : null,
    decoError,
  };
}
