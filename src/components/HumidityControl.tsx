import { useEffect, useState } from 'react';
import { api } from '../api';
import type { HumidityRule } from '../types';

const DEFAULTS = { enabled: true, from: '08:00', to: '22:00', onAbove: 60, offBelow: 50 };

const time = (iso: string) => new Date(iso).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });

/** Fuktstyring for én stikkontakt: på over / av under en grense, bare innenfor et tidsrom (av om natta). */
export function HumidityControl({ deviceId, houseId, name }: { deviceId: string; houseId: string; name: string }) {
  const [rule, setRule] = useState<HumidityRule | null>(null);
  const [form, setForm] = useState(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.humidityRules().then(
      (r) => {
        const existing = r.rules.find((x) => x.deviceId === deviceId) ?? null;
        setRule(existing);
        if (existing) setForm({ enabled: existing.enabled, from: existing.from, to: existing.to, onAbove: existing.onAbove, offBelow: existing.offBelow });
        setLoaded(true);
      },
      (e) => setError(e.message),
    );
  }, [deviceId]);

  async function save(next = form) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const r = await api.saveHumidityRule({ deviceId, houseId, name, ...next });
      setRule(r.rule);
      setForm(next);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke lagre');
    } finally {
      setBusy(false);
    }
  }

  if (!loaded && !error) return <p className="muted small">Henter fuktstyring…</p>;

  return (
    <div className="timer-plan humidity-control">
      {rule?.last && (
        <p className="small" style={{ margin: 0 }}>
          {rule.last.error ? (
            <span className="error">{rule.last.error}</span>
          ) : (
            <>
              Sist vurdert kl. {time(rule.last.at)}: <strong>{rule.last.reason}</strong>
              {rule.last.action !== 'none' ? ` – slo ${rule.last.action === 'on' ? 'på' : 'av'}` : rule.last.isOn != null ? ` – står ${rule.last.isOn ? 'på' : 'av'}` : ''}
            </>
          )}
        </p>
      )}

      <form
        className="period-form"
        style={{ borderTop: 'none', paddingTop: 0 }}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="period-row">
          <span className="switch sm">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} aria-label="Fuktstyring på" />
            <span />
          </span>
          <span>Styr etter luftfuktighet</span>
        </label>
        <div className="period-row">
          <span className="muted small">Kun mellom</span>
          <input type="time" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} aria-label="Fra" />
          <span className="muted small">og</span>
          <input type="time" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} aria-label="Til" />
        </div>
        <div className="period-row">
          <span className="muted small">På over</span>
          <input type="number" min={20} max={95} value={form.onAbove} onChange={(e) => setForm({ ...form, onAbove: Number(e.target.value) })} aria-label="På over prosent" className="pct-input" />
          <span className="muted small">% · av under</span>
          <input type="number" min={10} max={90} value={form.offBelow} onChange={(e) => setForm({ ...form, offBelow: Number(e.target.value) })} aria-label="Av under prosent" className="pct-input" />
          <span className="muted small">%</span>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Utenfor {form.from}–{form.to} holdes den av. Sjekkes hvert 5. minutt – backend må kjøre.
        </p>
        {error && <p className="error small">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Lagrer…' : saved ? 'Lagret' : 'Lagre fuktstyring'}</button>
      </form>
    </div>
  );
}
