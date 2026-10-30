import { useEffect, useState } from 'react';
import { api, setUnauthorizedHandler } from './api';
import { Login } from './components/Login';
import { Dashboard } from './components/Dashboard';
import { pollWithBackoff } from './useServicePoll';

const VERSION_POLL_MS = 5 * 60_000;

export function App() {
  const [user, setUser] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api.me().then((r) => setUser(r.login), () => setUser(null));
  }, []);

  // Nettbrettet står med siden åpen i dagevis: når serveren har fått ny kode, last inn den nye versjonen
  useEffect(() => {
    let first: string | null | undefined;
    return pollWithBackoff(async () => {
      const { version } = await api.version();
      if (first === undefined) first = version;
      else if (version && first && version !== first) window.location.reload();
      return true;
    }, VERSION_POLL_MS);
  }, []);

  if (user === undefined) return <div className="center muted">Laster…</div>;
  if (user === null) return <Login onLogin={setUser} />;
  return (
    <Dashboard
      user={user}
      onLogout={async () => {
        await api.logout().catch(() => {});
        setUser(null);
      }}
    />
  );
}
