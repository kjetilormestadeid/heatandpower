import { useEffect, useState } from 'react';

/** Klokke med ukedag og dato for topplinjen. Oppdateres hvert sekund så minuttskiftet kommer presist. */
export function Clock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="clock" aria-live="off">
      <time className="clock-time" dateTime={now.toISOString()}>
        {now.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })}
      </time>
      <span className="muted small clock-date hide-sm">
        {now.toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' })}
      </span>
    </div>
  );
}
