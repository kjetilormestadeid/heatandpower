import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api } from '../api';
import type { CalendarEvent } from '../types';
import { Icon } from './Icon';

const DAYS = 7;
const POLL_MS = 10 * 60_000;
const IDLE_CLOSE_MS = 60_000; // panelet glir ut igjen når ingen har rørt det på et minutt
const TICK_MS = 6_000; // så lenge hver avtale står i stripen før neste glir inn
const DAY = 86_400_000;
const CAL_COLORS = ['var(--series-1)', 'var(--mode-comfort)', 'var(--series-3)', 'var(--mode-sleep)'];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const hhmm = (d: Date) => d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });

/** Start/slutt som lokale tidspunkt. Heldagshendelser (YYYY-MM-DD) gjelder fra lokal midnatt. */
const range = (e: CalendarEvent) =>
  e.allDay
    ? { start: new Date(`${e.start}T00:00:00`), end: new Date(`${e.end}T00:00:00`) }
    : { start: new Date(e.start), end: new Date(e.end) };

/** Hendelser som berører dagen som starter i `day`. */
function eventsOn(events: CalendarEvent[], day: Date) {
  const from = day.getTime();
  const to = addDays(day, 1).getTime();
  return events.filter((e) => {
    const r = range(e);
    const end = Math.max(r.end.getTime(), r.start.getTime() + 1); // hendelser uten varighet
    return r.start.getTime() < to && end > from;
  });
}

// Felles kalenderdata for knappen, panelet og stripen i hurtigpanelet: én henting, flere lyttere
interface CalendarState {
  configured: boolean;
  events: CalendarEvent[] | null;
  error: string | null;
}
let calState: CalendarState = { configured: false, events: null, error: null };
const listeners = new Set<() => void>();
let started = false;

function setCal(patch: Partial<CalendarState>) {
  calState = { ...calState, ...patch };
  listeners.forEach((l) => l());
}

const loadCalendar = (fresh = false) =>
  api.calendarEvents(DAYS, fresh).then(
    (r) => setCal({ events: r.events, error: null }),
    (e) => setCal({ error: e instanceof Error ? e.message : 'Kunne ikke hente kalenderen' }),
  );

/** Henter kalenderen på nytt direkte fra kildene (brukes av «Oppdater» i topplinjen). */
export function refreshCalendar() {
  if (calState.configured) return loadCalendar(true);
}

function startCalendar() {
  if (started) return;
  started = true;
  const load = () => loadCalendar();
  api.calendarStatus().then((s) => {
    if (!s.configured) return;
    setCal({ configured: true });
    load();
    window.setInterval(() => document.visibilityState === 'visible' && load(), POLL_MS);
  }, () => (started = false));
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function useCalendar() {
  useEffect(startCalendar, []);
  return useSyncExternalStore(subscribe, () => calState);
}

/** «Nå», oppdatert hvert minutt så passerte avtaler forsvinner/blekner av seg selv. */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Fast farge per kalender (alfabetisk, så fargen ikke bytter når dagens hendelser endrer seg). */
function calendarColors(events: CalendarEvent[] | null) {
  const calendars = [...new Set(events?.map((e) => e.calendar ?? '') ?? [])].sort((a, b) => a.localeCompare(b, 'nb'));
  const colorOf = (e: CalendarEvent) => CAL_COLORS[calendars.indexOf(e.calendar ?? '') % CAL_COLORS.length];
  return { calendars, colorOf };
}

const OPEN_EVENT = 'calendar:open';
const openCalendar = () => window.dispatchEvent(new Event(OPEN_EVENT));

/** Kalenderknapp i topplinjen med neste hendelse, og et panel som glir inn fra høyre med i dag og i morgen i fokus. */
export function CalendarDrawer() {
  const { configured, events, error } = useCalendar();
  const now = useNow();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const touchX = useRef<number | null>(null);

  // Stripen i hurtigpanelet åpner panelet
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  // Lukk med Esc, og av seg selv når panelet har stått urørt en stund
  useEffect(() => {
    if (!open) return;
    let t = window.setTimeout(() => setOpen(false), IDLE_CLOSE_MS);
    const touch = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => setOpen(false), IDLE_CLOSE_MS);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const panel = panelRef.current;
    panel?.addEventListener('pointerdown', touch);
    panel?.addEventListener('scroll', touch, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      panel?.removeEventListener('pointerdown', touch);
      panel?.removeEventListener('scroll', touch, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!configured) return null;

  const today = startOfDay(now);
  const next = events?.find((e) => !e.allDay && new Date(e.end) > now && new Date(e.start) < addDays(today, 1));
  const laterDays = Array.from({ length: DAYS - 2 }, (_, i) => addDays(today, i + 2));
  const { calendars, colorOf } = calendarColors(events);

  return (
    <>
      <button className="cal-toggle" aria-expanded={open} aria-controls="calendar-drawer" onClick={() => setOpen((o) => !o)}>
        <Icon name="calendar" />
        <span className="hide-sm cal-next">
          {next ? (
            <>
              <strong>{new Date(next.start) <= now ? 'Nå' : hhmm(new Date(next.start))}</strong> {next.title}
            </>
          ) : (
            'Kalender'
          )}
        </span>
      </button>

      <div className={`cal-backdrop ${open ? 'open' : ''}`} onClick={() => setOpen(false)} aria-hidden />
      <aside
        id="calendar-drawer"
        ref={panelRef}
        className={`cal-drawer ${open ? 'open' : ''}`}
        aria-label="Kalender"
        aria-hidden={!open}
        inert={!open}
        onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          // Sveip mot høyre lukker panelet
          if (touchX.current != null && e.changedTouches[0].clientX - touchX.current > 80) setOpen(false);
          touchX.current = null;
        }}
      >
        <div className="cal-head">
          <h2>Kalender</h2>
          <div className="spacer" />
          <button className="icon cal-close" aria-label="Lukk kalenderen" onClick={() => setOpen(false)}>
            <Icon name="close" />
          </button>
        </div>
        {calendars.length > 1 && (
          <div className="legend">
            {calendars.map((c, i) => (
              <span key={c}>
                <i className="swatch" style={{ background: CAL_COLORS[i % CAL_COLORS.length] }} />
                {c || 'Kalender'}
              </span>
            ))}
          </div>
        )}
        {error && <p className="error small">{error}</p>}
        {!events && !error && <p className="muted small">Henter kalenderen…</p>}
        {events && (
          <>
            <DaySection label="I dag" day={today} events={eventsOn(events, today)} now={now} colorOf={colorOf} focus />
            <DaySection label="I morgen" day={addDays(today, 1)} events={eventsOn(events, addDays(today, 1))} now={now} colorOf={colorOf} focus />
            <div className="cal-later">
              <h3 className="muted">Senere</h3>
              {laterDays.every((d) => eventsOn(events, d).length === 0) && <p className="muted small">Ingenting de neste dagene.</p>}
              {laterDays.map((d) => {
                const list = eventsOn(events, d);
                return list.length ? <DaySection key={d.getTime()} day={d} events={list} now={now} colorOf={colorOf} /> : null;
              })}
            </div>
          </>
        )}
      </aside>
    </>
  );
}

function DaySection({
  label,
  day,
  events,
  now,
  colorOf,
  focus,
}: {
  label?: string;
  day: Date;
  events: CalendarEvent[];
  now: Date;
  colorOf: (e: CalendarEvent) => string;
  focus?: boolean;
}) {
  const date = day.toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <section className={`cal-day ${focus ? 'focus' : ''}`}>
      <h3>
        {label ?? date}
        {label && <span className="muted small"> {date}</span>}
      </h3>
      {events.length === 0 ? (
        <p className="muted small">Ingen avtaler</p>
      ) : (
        <ul className="cal-list">
          {events.map((e) => (
            <EventRow key={e.id} event={e} day={day} now={now} color={colorOf(e)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function EventRow({ event, day, now, color }: { event: CalendarEvent; day: Date; now: Date; color: string }) {
  const { start, end } = range(event);
  const past = end.getTime() === start.getTime() ? start < now : end <= now;
  const current = !event.allDay && start <= now && end > now;
  // Hendelser som går over flere dager viser bare den delen som gjelder denne dagen
  const startsToday = start.getTime() >= day.getTime();
  const endsToday = end.getTime() <= day.getTime() + DAY;
  const time = event.allDay
    ? 'Hele dagen'
    : `${startsToday ? hhmm(start) : '…'}${end > start ? `–${endsToday ? hhmm(end) : '…'}` : ''}`;
  return (
    <li className={`${past ? 'past' : ''} ${current ? 'current' : ''}`} style={{ '--cal-color': color } as React.CSSProperties} title={event.calendar ?? undefined}>
      <span className="cal-time">{time}</span>
      <span className="cal-what">
        <strong>{event.title}</strong>
        {event.location && <span className="muted small">{event.location}</span>}
      </span>
      {current && <span className="pill cal-now">Nå</span>}
    </li>
  );
}

/** Stripe ved siden av forbruket: dagens gjenstående avtaler (så morgendagens) glir inn én om gangen. Trykk åpner panelet. */
export function CalendarTicker() {
  const { configured, events, error } = useCalendar();
  const now = useNow();
  const [idx, setIdx] = useState(0);
  const [leaving, setLeaving] = useState(false);

  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const todayItems = eventsOn(events ?? [], today).filter((e) => e.allDay || range(e).end > now);
  // Avtaler som går over midnatt vises bare én gang, under i dag
  const shown = new Set(todayItems.map((e) => e.id));
  const items = [
    ...todayItems.map((e) => ({ e, day: 'I dag' })),
    ...eventsOn(events ?? [], tomorrow)
      .filter((e) => !shown.has(e.id))
      .map((e) => ({ e, day: 'I morgen' })),
  ];
  const count = items.length;

  // Bytt avtale med jevne mellomrom: gammel glir ut, ny glir inn
  useEffect(() => {
    if (count < 2) return;
    let out: number | undefined;
    const t = window.setInterval(() => {
      setLeaving(true);
      out = window.setTimeout(() => {
        setIdx((i) => i + 1);
        setLeaving(false);
      }, 350);
    }, TICK_MS);
    return () => {
      window.clearInterval(t);
      window.clearTimeout(out);
    };
  }, [count]);

  if (!configured || !events) return null;
  const { colorOf } = calendarColors(events);
  const item = count ? items[idx % count] : null;

  return (
    <button className={`cal-ticker ${error ? 'stale' : ''}`} onClick={openCalendar} aria-label="Åpne kalenderen">
      {error && <span className="quick-stale" title={error}>Ingen kontakt</span>}
      {item ? (
        <span
          key={`${item.e.id}-${idx}`}
          className={`cal-ticker-item ${leaving ? 'leaving' : ''}`}
          style={{ '--cal-color': colorOf(item.e) } as React.CSSProperties}
        >
          <span className="muted small">
            {item.day} · {tickerTime(item.e, now)}
          </span>
          <strong>{item.e.title}</strong>
          <span className="muted small cal-ticker-loc">{item.e.location ?? ' '}</span>
        </span>
      ) : (
        <span className="cal-ticker-item">
          <span className="muted small">Kalender</span>
          <strong>Ingen flere avtaler i dag eller i morgen</strong>
        </span>
      )}
      {count > 1 && (
        <span className="cal-ticker-dots" aria-hidden>
          {items.map((it, i) => (
            <i key={it.e.id + it.day} className={i === idx % count ? 'on' : ''} />
          ))}
        </span>
      )}
    </button>
  );
}

function tickerTime(e: CalendarEvent, now: Date) {
  if (e.allDay) return 'hele dagen';
  const { start, end } = range(e);
  if (start <= now && end > now) return `nå, til ${hhmm(end)}`;
  return end > start ? `${hhmm(start)}–${hhmm(end)}` : hhmm(start);
}
