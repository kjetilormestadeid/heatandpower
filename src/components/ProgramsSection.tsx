import { useState } from 'react';
import { api } from '../api';
import type { Room, RoomProgram } from '../types';
import { ModeLegend, ProgramEditor, DayBar, programToBars } from './ProgramEditor';

export function ProgramsSection({
  houseId,
  programs,
  rooms,
  onChanged,
}: {
  houseId: string;
  programs: RoomProgram[];
  rooms: Room[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    const name = prompt('Navn på nytt ukeprogram:')?.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.createRoomProgram(houseId, name);
      onChanged();
      setEditing(r.roomProgram.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke opprette program');
    } finally {
      setBusy(false);
    }
  }

  const current = programs.find((p) => p.id === editing);

  return (
    <section className="card programs">
      <div className="section-head">
        <h2>Ukeprogrammer</h2>
        <div className="spacer" />
        <button onClick={create} disabled={busy}>+ Nytt program</button>
      </div>
      {error && <p className="error small">{error}</p>}

      {current ? (
        <ProgramEditor
          key={current.id}
          program={current}
          onSaved={onChanged}
          onClose={() => setEditing(null)}
        />
      ) : (
        <>
          <ModeLegend />
          <div className="program-grid">
            {programs.map((p) => {
              const used = rooms.filter((r) => r.roomProgramId === p.id);
              return (
                <button key={p.id} className="program-card" aria-label={`Rediger ${p.name}`} onClick={() => setEditing(p.id)}>
                  <div className="program-title">
                    <strong>{p.name}</strong>
                    {p.isDefault && <span className="pill">Standard</span>}
                  </div>
                  <div className="mini-week">
                    {programToBars(p).map((b) => (
                      <div className="week-row" key={b.day}>
                        <span className="muted small">{b.label}</span>
                        <DayBar entries={b.entries} />
                      </div>
                    ))}
                  </div>
                  <span className="muted small">
                    {used.length ? `Brukes av: ${used.map((r) => r.name).join(', ')}` : 'Ikke i bruk'}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
