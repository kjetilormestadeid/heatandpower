import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { MillError, getSession, loadSessions, millRequest, signIn, signOut } from './mill.ts';
import { TibberError, tibberConfigured, tibberHomes, tibberOverview } from './tibber.ts';

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

app.get('/api/tibber/homes/:homeId', requireSession, async (req, res) => {
  const resolution = req.query.resolution === 'QUARTER_HOURLY' ? 'QUARTER_HOURLY' : 'HOURLY';
  try {
    res.json(await tibberOverview(String(req.params.homeId), resolution));
  } catch (err) {
    sendTibberError(res, err);
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
app.listen(PORT, () => console.log(`Mill-backend kjører på http://localhost:${PORT}`));
