import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { MillError, getSession, loadSessions, millRequest, signIn, signOut } from './mill.ts';
import { TibberError, tibberConfigured, tibberHomes, tibberLive, tibberOverview } from './tibber.ts';
import { HueError, hueAuthorizeUrl, hueCallback, hueConfigured, hueConnected, hueDisconnect, hueDimGroup, hueDimLight, hueGroups, hueIdentifyLight, hueLights, hueRenameGroup, hueRenameLight, hueSetGroup, hueSetLight } from './hue.ts';
import { SonosError, isSonosCommand, parseRedirect, sonosAuthorizeUrl, sonosCommand, sonosComplete, sonosConfigured, sonosConnected, sonosDisconnect, sonosFavorite, sonosOverview, sonosPauseAll, sonosPlayerFavorite, sonosVolume } from './sonos.ts';
import { millNetworkDiagnostics } from './diagnostics.ts';
import { humidityRules, saveHumidityRule, startAutomations } from './automation.ts';
import { DecoError, decoConfigured, decoOverview, decoSetOwner } from './deco.ts';
import { EaseeError, easeeCharger, easeeChargers, easeeCommand, easeeConfigured, isEaseeCommand } from './easee.ts';
import { CalendarError, calendarConfigured, calendarEvents } from './calendar.ts';
import { ApplianceError, addAppliance, analyzeIdentify, applianceStates, cancelIdentify, identifySamples, removeAppliance, setApplianceOn, startApplianceTracking, startIdentify } from './appliances.ts';

const PORT = Number(process.env.PORT ?? 3001);
const COOKIE = 'mill_sid';
const isProd = process.env.NODE_ENV === 'production';

// Endepunkter siten ikke skal kunne nå via proxyen (konto-/auth-operasjoner).
const BLOCKED = [/^\/customer\/auth\//, /^\/customer\/delete/, /^\/customer\/change-/, /^\/customer\/api-access/];

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.COOKIE_SECURE === 'true',
  maxAge: 400 * 24 * 3600 * 1000,
  path: '/',
};

function sid(req: Request): string | undefined {
  return req.cookies?.[COOKIE];
}

function sendError(res: Response, err: unknown) {
  if (err instanceof MillError) {
    res.status(err.status).json(err.body ?? { error: { message: `Mill API ${err.status}` } });
  } else {
    console.error(err);
    res.status(502).json({ error: { type: 'ProxyError', message: 'Fikk ikke kontakt med Mill API' } });
  }
}

app.post('/api/auth/login', async (req, res) => {
  const { login, password } = req.body ?? {};
  if (typeof login !== 'string' || typeof password !== 'string' || !login || !password) {
    res.status(400).json({ error: { message: 'E-post/telefon og passord må fylles ut' } });
    return;
  }
  try {
    const id = await signIn(login.trim(), password);
    res.cookie(COOKIE, id, cookieOpts).json({ login: login.trim() });
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/auth/logout', async (req, res) => {
  const id = sid(req);
  if (id) await signOut(id);
  res.clearCookie(COOKIE, { path: '/' }).json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const s = getSession(sid(req));
  if (!s) {
    res.status(401).json({ error: { message: 'Ikke innlogget' } });
    return;
  }
  res.json({ login: s.login });
});

// Generisk proxy: /api/mill/<sti> -> Mill API <sti>, med brukerens token.
app.use('/api/mill', async (req: Request, res: Response) => {
  const id = sid(req);
  if (!getSession(id)) {
    res.status(401).json({ error: { message: 'Ikke innlogget' } });
    return;
  }
  const urlPath = req.url; // inkluderer query
  if (BLOCKED.some((r) => r.test(urlPath))) {
    res.status(403).json({ error: { message: 'Endepunktet er ikke tilgjengelig via denne siten' } });
    return;
  }
  try {
    const hasBody = !['GET', 'HEAD', 'DELETE'].includes(req.method) || (req.body && Object.keys(req.body).length > 0);
    const { status, data } = await millRequest(id!, req.method, urlPath, hasBody ? req.body : undefined);
    if (data === null) res.status(status).end();
    else res.status(status).json(data);
  } catch (err) {
    sendError(res, err);
  }
});

// Tibber: token ligger i .env; kun innloggede brukere av siten får lese.
function requireSession(req: Request, res: Response, next: NextFunction) {
  if (!getSession(sid(req))) {
    res.status(401).json({ error: { message: 'Ikke innlogget' } });
    return;
  }
  next();
}

function sendTibberError(res: Response, err: unknown) {
  if (err instanceof TibberError) res.status(err.status).json({ error: { message: err.message } });
  else sendError(res, err);
}

app.get('/api/tibber/status', requireSession, (_req, res) => {
  res.json({ configured: tibberConfigured() });
});

app.get('/api/tibber/homes', requireSession, async (_req, res) => {
  try {
    res.json({ homes: await tibberHomes() });
  } catch (err) {
    sendTibberError(res, err);
  }
});

app.get('/api/tibber/live', requireSession, async (_req, res) => {
  try {
    res.json(await tibberLive());
  } catch (err) {
    sendTibberError(res, err);
  }
});

app.get('/api/tibber/homes/:homeId', requireSession, async (req, res) => {
  const resolution = req.query.resolution === 'QUARTER_HOURLY' ? 'QUARTER_HOURLY' : 'HOURLY';
  try {
    res.json(await tibberOverview(String(req.params.homeId), resolution));
  } catch (err) {
    sendTibberError(res, err);
  }
});

// Kalender: ICS-abonnement fra .env. Sender hendelser fra midnatt i dag og `days` dager frem.
app.get('/api/calendar/status', requireSession, (_req, res) => {
  res.json({ configured: calendarConfigured() });
});

app.get('/api/calendar/events', requireSession, async (req, res) => {
  const days = Math.min(31, Math.max(1, Number(req.query.days) || 7));
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + days);
  try {
    res.json({ events: await calendarEvents(from, to, req.query.fresh === '1') });
  } catch (err) {
    if (err instanceof CalendarError) res.status(err.status).json({ error: { message: err.message } });
    else sendError(res, err);
  }
});

// Easee: brukernavn/passord ligger i .env; kun innloggede brukere av siten får lese/styre.
function sendEaseeError(res: Response, err: unknown) {
  if (err instanceof EaseeError) res.status(err.status).json({ error: { message: err.message } });
  else sendError(res, err);
}

app.get('/api/easee/status', requireSession, (_req, res) => {
  res.json({ configured: easeeConfigured() });
});

app.get('/api/easee/chargers', requireSession, async (_req, res) => {
  try {
    res.json({ chargers: await easeeChargers() });
  } catch (err) {
    sendEaseeError(res, err);
  }
});

app.get('/api/easee/chargers/:id', requireSession, async (req, res) => {
  try {
    res.json(await easeeCharger(String(req.params.id)));
  } catch (err) {
    sendEaseeError(res, err);
  }
});

app.post('/api/easee/chargers/:id/:command', requireSession, async (req, res) => {
  const command = String(req.params.command);
  if (!isEaseeCommand(command)) {
    res.status(400).json({ error: { message: 'Ukjent kommando' } });
    return;
  }
  try {
    await easeeCommand(String(req.params.id), command);
    res.status(204).end();
  } catch (err) {
    sendEaseeError(res, err);
  }
});

// Philips Hue (Remote API): OAuth-innlogging én gang, deretter lagres token på serveren.
function sendHueError(res: Response, err: unknown) {
  if (err instanceof HueError) res.status(err.status).json({ error: { message: err.message } });
  else sendError(res, err);
}

app.get('/api/hue/status', requireSession, async (_req, res) => {
  res.json({ configured: hueConfigured(), connected: await hueConnected() });
});

app.get('/api/hue/login', requireSession, (_req, res) => {
  try {
    res.redirect(hueAuthorizeUrl());
  } catch (err) {
    sendHueError(res, err);
  }
});

app.get('/api/hue/callback', requireSession, async (req, res) => {
  try {
    if (req.query.error) throw new HueError(400, `Hue: ${String(req.query.error)}`);
    await hueCallback(String(req.query.code ?? ''), String(req.query.state ?? ''));
    res.redirect('/?hue=ok');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Hue-innlogging feilet';
    res.redirect(`/?hue_error=${encodeURIComponent(msg)}`);
  }
});

app.post('/api/hue/logout', requireSession, async (_req, res) => {
  await hueDisconnect();
  res.status(204).end();
});

app.get('/api/hue/lights', requireSession, async (_req, res) => {
  try {
    res.json({ lights: await hueLights() });
  } catch (err) {
    sendHueError(res, err);
  }
});

app.get('/api/hue/groups', requireSession, async (_req, res) => {
  try {
    res.json({ groups: await hueGroups() });
  } catch (err) {
    sendHueError(res, err);
  }
});

for (const kind of ['room', 'zone'] as const) {
  app.put(`/api/hue/${kind}s/:id`, requireSession, async (req, res) => {
    if (typeof req.body?.name !== 'string') {
      res.status(400).json({ error: { message: 'Forventet { name: string }' } });
      return;
    }
    try {
      await hueRenameGroup(kind, String(req.params.id), req.body.name);
      res.status(204).end();
    } catch (err) {
      sendHueError(res, err);
    }
  });
}

app.put('/api/hue/groups/:id', requireSession, async (req, res) => {
  const { on, brightness } = req.body ?? {};
  if (typeof on !== 'boolean' && typeof brightness !== 'number') {
    res.status(400).json({ error: { message: 'Forventet { on: boolean } eller { brightness: number }' } });
    return;
  }
  try {
    if (typeof brightness === 'number') await hueDimGroup(String(req.params.id), brightness);
    else await hueSetGroup(String(req.params.id), on);
    res.status(204).end();
  } catch (err) {
    sendHueError(res, err);
  }
});

app.put('/api/hue/lights/:id', requireSession, async (req, res) => {
  const { on, name, identify, brightness } = req.body ?? {};
  if (typeof on !== 'boolean' && typeof name !== 'string' && identify !== true && typeof brightness !== 'number') {
    res.status(400).json({ error: { message: 'Forventet { on }, { name }, { identify: true } eller { brightness }' } });
    return;
  }
  try {
    if (typeof brightness === 'number') await hueDimLight(String(req.params.id), brightness);
    if (identify === true) await hueIdentifyLight(String(req.params.id));
    if (typeof name === 'string') await hueRenameLight(String(req.params.id), name);
    if (typeof on === 'boolean') await hueSetLight(String(req.params.id), on);
    res.status(204).end();
  } catch (err) {
    sendHueError(res, err);
  }
});

// TP-Link Deco: lokalt API – backend må kjøre på hjemmenettet.
function sendDecoError(res: Response, err: unknown) {
  if (err instanceof DecoError) res.status(err.status).json({ error: { message: err.message } });
  else sendError(res, err);
}

app.get('/api/deco/status', requireSession, (_req, res) => {
  res.json({ configured: decoConfigured() });
});

app.get('/api/deco/overview', requireSession, async (_req, res) => {
  try {
    res.json(await decoOverview());
  } catch (err) {
    sendDecoError(res, err);
  }
});

app.put('/api/deco/owners/:mac', requireSession, async (req, res) => {
  if (typeof req.body?.name !== 'string') {
    res.status(400).json({ error: { message: 'Forventet { name: string }' } });
    return;
  }
  try {
    res.json({ people: await decoSetOwner(String(req.params.mac), req.body.name) });
  } catch (err) {
    sendDecoError(res, err);
  }
});

// Apparatgjenkjenning fra Tibber Pulse (identifiser-modus med OpenAI-analyse)
function sendApplianceError(res: Response, err: unknown) {
  if (err instanceof ApplianceError || err instanceof TibberError) res.status(err.status).json({ error: { message: err.message } });
  else sendError(res, err);
}

app.get('/api/appliances', requireSession, async (_req, res) => {
  res.json(await applianceStates());
});

app.post('/api/appliances', requireSession, async (req, res) => {
  const { name, watts, source } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim() || typeof watts !== 'number' || !(watts > 0) || watts > 50_000) {
    res.status(400).json({ error: { message: 'Navn og effekt (W) må fylles ut' } });
    return;
  }
  res.json({ appliance: await addAppliance(name, watts, source === 'ai' || source === 'local' ? source : 'manual') });
});

app.delete('/api/appliances/:id', requireSession, async (req, res) => {
  await removeAppliance(String(req.params.id));
  res.json({ ok: true });
});

app.put('/api/appliances/:id/state', requireSession, async (req, res) => {
  if (typeof req.body?.on !== 'boolean') {
    res.status(400).json({ error: { message: 'on må være true/false' } });
    return;
  }
  try {
    await setApplianceOn(String(req.params.id), req.body.on);
    res.json({ ok: true });
  } catch (err) {
    sendApplianceError(res, err);
  }
});

app.post('/api/appliances/identify/start', requireSession, (_req, res) => {
  try {
    res.json(startIdentify());
  } catch (err) {
    sendApplianceError(res, err);
  }
});

app.get('/api/appliances/identify', requireSession, (_req, res) => {
  res.json(identifySamples());
});

app.post('/api/appliances/identify/cancel', requireSession, (_req, res) => {
  cancelIdentify();
  res.json({ ok: true });
});

app.post('/api/appliances/identify/analyze', requireSession, async (req, res) => {
  try {
    res.json(await analyzeIdentify(typeof req.body?.hint === 'string' ? req.body.hint : ''));
  } catch (err) {
    sendApplianceError(res, err);
  }
});

// Automasjoner: fuktstyring av stikkontakter (f.eks. avfukter) – kjører i backend.
app.get('/api/automations/humidity', requireSession, async (_req, res) => {
  res.json({ rules: await humidityRules() });
});

app.put('/api/automations/humidity/:deviceId', requireSession, async (req, res) => {
  const b = req.body ?? {};
  const ok =
    typeof b.houseId === 'string' && typeof b.name === 'string' && typeof b.enabled === 'boolean' &&
    typeof b.from === 'string' && typeof b.to === 'string' && typeof b.onAbove === 'number' && typeof b.offBelow === 'number';
  if (!ok) {
    res.status(400).json({ error: { message: 'Ugyldig regel' } });
    return;
  }
  try {
    const rule = await saveHumidityRule(sid(req)!, {
      deviceId: String(req.params.deviceId), houseId: b.houseId, name: b.name, enabled: b.enabled,
      from: b.from, to: b.to, onAbove: b.onAbove, offBelow: b.offBelow,
    });
    res.json({ rule });
  } catch (err) {
    res.status(400).json({ error: { message: err instanceof Error ? err.message : 'Kunne ikke lagre' } });
  }
});

// Sonos (Control API, via skyen)
function sendSonosError(res: Response, err: unknown) {
  if (err instanceof SonosError) res.status(err.status).json({ error: { message: err.message } });
  else sendError(res, err);
}
const sonosRoute = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    const out = await fn(req);
    if (out === undefined) res.status(204).end();
    else res.json(out);
  } catch (err) {
    sendSonosError(res, err);
  }
};

app.get('/api/sonos/status', requireSession, async (_req, res) => {
  res.json({ configured: sonosConfigured(), connected: await sonosConnected() });
});
app.get('/api/sonos/login', requireSession, (_req, res) => {
  try {
    res.redirect(sonosAuthorizeUrl());
  } catch (err) {
    sendSonosError(res, err);
  }
});
// Brukes hvis redirect-URL-en (via en videresending) lander her
app.get('/api/sonos/callback', requireSession, async (req, res) => {
  try {
    await sonosComplete(String(req.query.code ?? ''), String(req.query.state ?? ''));
    res.redirect('/?sonos=ok');
  } catch (err) {
    res.redirect(`/?sonos_error=${encodeURIComponent(err instanceof Error ? err.message : 'Sonos-innlogging feilet')}`);
  }
});
// Alternativ: lim inn adressen man havnet på etter godkjenning hos Sonos
app.post('/api/sonos/complete', requireSession, sonosRoute(async (req) => {
  const { code, state } = parseRedirect(String(req.body?.url ?? ''));
  await sonosComplete(code, state);
}));
app.post('/api/sonos/logout', requireSession, sonosRoute(() => sonosDisconnect()));
app.get('/api/sonos/overview', requireSession, sonosRoute(() => sonosOverview()));
app.post('/api/sonos/pause-all', requireSession, sonosRoute(() => sonosPauseAll()));
app.post('/api/sonos/groups/:id/volume', requireSession, sonosRoute(async (req) => {
  if (typeof req.body?.volume !== 'number') throw new SonosError(400, 'Forventet { volume: number }');
  await sonosVolume(String(req.params.id), req.body.volume);
}));
app.post('/api/sonos/groups/:id/favorite', requireSession, sonosRoute(async (req) => {
  if (typeof req.body?.favoriteId !== 'string') throw new SonosError(400, 'Forventet { favoriteId: string }');
  await sonosFavorite(String(req.params.id), req.body.favoriteId);
}));
app.post('/api/sonos/players/:id/favorite', requireSession, sonosRoute(async (req) => {
  if (typeof req.body?.favoriteId !== 'string') throw new SonosError(400, 'Forventet { favoriteId: string }');
  await sonosPlayerFavorite(String(req.params.id), req.body.favoriteId);
}));
app.post('/api/sonos/groups/:id/:command', requireSession, sonosRoute(async (req) => {
  const c = String(req.params.command);
  if (!isSonosCommand(c)) throw new SonosError(400, 'Ukjent kommando');
  await sonosCommand(String(req.params.id), c);
}));

// Feilsøking: Mill-enheter mot det Deco ser på wifi
app.get('/api/diagnostics/mill-network', requireSession, async (req, res) => {
  try {
    res.json(await millNetworkDiagnostics(sid(req)!));
  } catch (err) {
    sendError(res, err);
  }
});

if (isProd) {
  const dist = path.resolve('dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => sendError(res, err));

await loadSessions();
startAutomations();
void startApplianceTracking();
app.listen(PORT, () => console.log(`Mill-backend kjører på http://localhost:${PORT}`));
