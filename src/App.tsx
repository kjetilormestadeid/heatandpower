import { useEffect, useState } from 'react';
import { api, setUnauthorizedHandler } from './api';
import { Login } from './components/Login';
import { Dashboard } from './components/Dashboard';

export function App() {
  const [user, setUser] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api.me().then((r) => setUser(r.login), () => setUser(null));
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
