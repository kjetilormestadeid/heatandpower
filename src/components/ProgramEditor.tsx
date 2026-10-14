import { useState } from 'react';
import { api } from '../api';
import { PROGRAM_DAYS, type ProgramDay, type ProgramEntry, type ProgramMode, type RoomProgram } from '../types';
import { MODE_LABEL } from '../format';

export const PROGRAM_MODES: ProgramMode[] = ['comfort', 'sleep', 'away', 'normal', 'always_heating', 'off'];

const DAY_LABEL: Record<ProgramDay, string> = {
  monday: 'Mandag', tuesday: 'Tirsdag', wednesday: 'Onsdag', thursday: 'Torsdag',
  friday: 'Fredag', saturday: 'Lørdag', sunday: 'Søndag',
};

type Entry = { min: number; mode: ProgramMode };
type Week = Record<ProgramDay, Entry[]>;

const DAY_MIN = 1440;
const parse = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const toApi = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
const toInput = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

function toWeek(p: RoomProgram): Week {
  const w = {} as Week;
  for (const d of PROGRAM_DAYS) {
    const list = (p.data[d] ?? []).map((e) => ({ min: parse(e.startTime), mode: e.temperatureType }));
    w[d] = list.length ? list.sort((a, b) => a.min - b.min) : [{ min: 0, mode: 'comfort' }];
    if (w[d][0].min !== 0) w[d].unshift({ min: 0, mode: w[d][w[d].length - 1].mode });
  }
  return w;
}

function fromWeek(w: Week): RoomProgram['data'] {
  const data: RoomProgram['data'] = {};
  for (const d of PROGRAM_DAYS) {
    // ett punkt per tidspunkt (siste vinner), sortert, og slå sammen påfølgende like moduser
    const byTime = new Map<number, ProgramMode>();
    for (const e of w[d]) byTime.set(e.min, e.mode);
    const out: ProgramEntry[] = [];
    for (const [min, mode] of [...byTime].sort((a, b) => a[0] - b[0])) {
      if (out.at(-1)?.temperatureType !== mode) out.push({ startTime: toApi(min), temperatureType: mode });
    }
    data[d] = out;
  }
  return data;
}

export function DayBar({ entries }: { entries: { min: number; mode: ProgramMode }[] }) {
  const sorted = [...entries].sort((a, b) => a.min - b.min);
  return (
    <div className="track program-track">
      {sorted.map((e, i) => {
        const end = i + 1 < sorted.length ? sorted[i + 1].min : DAY_MIN;
        if (end <= e.min) return null;
        return (
          <div
            key={`${e.min}-${i}`}
            className={`seg-mode mode-${e.mode}`}
            style={{ left: `${(e.min / DAY_MIN) * 100}%`, width: `${((end - e.min) / DAY_MIN) * 100}%` }}
            title={`${MODE_LABEL[e.mode]} ${toInput(e.min)}–${toInput(end % DAY_MIN)}`}
          />
        );
      })}
    </div>
  );
}

export function ModeLegend() {
  return (
    <div className="legend">
      {PROGRAM_MODES.map((m) => (
        <span key={m}>
          <i className={`swatch mode-${m}`} />
          {MODE_LABEL[m]}
        </span>
      ))}
    </div>
  );
}

export function programToBars(p: RoomProgram) {
  const w = toWeek(p);
  return PROGRAM_DAYS.map((d) => ({ day: d, label: DAY_LABEL[d].slice(0, 3), entries: w[d] }));
}

export function ProgramEditor({
  program,
  onSaved,
  onClose,
}: {
  program: RoomProgram;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(program.name);
  const [week, setWeek] = useState<Week>(() => toWeek(program));
  const [openDay, setOpenDay] = useState<ProgramDay | null>('monday');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  function update(day: ProgramDay, fn: (list: Entry[]) => Entry[]) {
    setWeek((w) => ({ ...w, [day]: fn(w[day]) }));
    setDirty(true);
  }

  function copyTo(from: ProgramDay, targets: readonly ProgramDay[]) {
    setWeek((w) => {
      const next = { ...w };
      for (const t of targets) if (t !== from) next[t] = w[from].map((e) => ({ ...e }));
      return next;
    });
    setDirty(true);
  }

  async function save() {
    if (!name.trim()) return setError('Programmet må ha et navn');
    setBusy(true);
    setError(null);
    try {
      await api.updateRoomProgram(program.houseId, program.id, { name: name.trim(), data: fromWeek(week) });
      setDirty(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke lagre');
    } finally {
      setBusy(false);
    }
  }

  function close() {
    if (dirty && !confirm('Forkaste endringene?')) return;
    onClose();
  }

  return (
    <div className="program-editor">
      <div className="section-head">
        <input className="name-input" value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} aria-label="Programnavn" maxLength={50} />
        <button onClick={close} disabled={busy}>Lukk</button>
        <button className="primary" onClick={save} disabled={busy || !dirty}>
          {busy ? 'Lagrer…' : 'Lagre'}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
      <ModeLegend />

      <div className="days-list">
        {PROGRAM_DAYS.map((d) => (
          <div key={d} className={`day ${openDay === d ? 'open' : ''}`}>
            <button className="day-head" onClick={() => setOpenDay(openDay === d ? null : d)} aria-expanded={openDay === d}>
              <span className="day-name">{DAY_LABEL[d]}</span>
              <DayBar entries={week[d]} />
            </button>

            {openDay === d && (
              <div className="day-body">
                {[...week[d]]
                  .map((e, i) => ({ e, i }))
                  .sort((a, b) => a.e.min - b.e.min)
                  .map(({ e, i }) => (
                    <div className="entry" key={i}>
                      <input
                        type="time"
                        value={toInput(e.min)}
                        disabled={e.min === 0 && i === 0}
                        aria-label="Starttid"
                        onChange={(ev) => {
                          if (!ev.target.value) return;
                          const min = parse(ev.target.value);
                          update(d, (list) => list.map((x, j) => (j === i ? { ...x, min } : x)));
                        }}
                      />
                      <select
                        value={e.mode}
                        aria-label="Modus"
                        onChange={(ev) => update(d, (list) => list.map((x, j) => (j === i ? { ...x, mode: ev.target.value as ProgramMode } : x)))}
                      >
                        {PROGRAM_MODES.map((m) => (
                          <option key={m} value={m}>{MODE_LABEL[m]}</option>
                        ))}
                      </select>
                      <i className={`swatch mode-${e.mode}`} />
                      {!(e.min === 0 && i === 0) && (
                        <button className="icon" aria-label="Fjern tidspunkt" onClick={() => update(d, (list) => list.filter((_, j) => j !== i))}>
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                <div className="day-actions">
                  <button
                    className="link"
                    onClick={() =>
                      update(d, (list) => {
                        const lastMin = Math.max(...list.map((x) => x.min));
                        return [...list, { min: Math.min(lastMin + 60, DAY_MIN - 1), mode: 'comfort' }];
                      })
                    }
                  >
                    + Legg til tidspunkt
                  </button>
                  <span className="spacer" />
                  <span className="muted small">Kopier til:</span>
                  <button className="link" onClick={() => copyTo(d, PROGRAM_DAYS.slice(0, 5))}>Hverdager</button>
                  <button className="link" onClick={() => copyTo(d, PROGRAM_DAYS.slice(5))}>Helg</button>
                  <button className="link" onClick={() => copyTo(d, PROGRAM_DAYS)}>Alle</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
