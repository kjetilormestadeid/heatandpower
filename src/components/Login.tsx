import { useState, type FormEvent } from 'react';
import { api } from '../api';

export function Login({ onLogin }: { onLogin: (login: string) => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.login(login, password);
      onLogin(r.login);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Innlogging feilet');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <h1>Mill Oversikt</h1>
        <p className="muted">Logg inn med Mill-kontoen din (samme som i Mill-appen).</p>
        <label>
          E-post eller telefon
          <input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" autoFocus />
        </label>
        <label>
          Passord
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy || !login || !password}>
          {busy ? 'Logger inn…' : 'Logg inn'}
        </button>
      </form>
    </div>
  );
}
