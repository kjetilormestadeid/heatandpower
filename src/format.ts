import type { Mode } from './types';

export const MODE_LABEL: Record<Mode, string> = {
  weekly_program: 'Ukeprogram',
  comfort: 'Komfort',
  sleep: 'Natt',
  away: 'Borte',
  vacation: 'Ferie',
  normal: 'Normal',
  always_heating: 'Alltid varme',
  off: 'Av',
};

export const fmtTemp = (t: number | null | undefined) =>
  t == null || t <= -100 ? '–' : `${t.toLocaleString('nb-NO', { maximumFractionDigits: 1 })}°`;

export const fmtKwh = (wh: number) =>
  `${(wh / 1000).toLocaleString('nb-NO', { maximumFractionDigits: wh < 10_000 ? 2 : 1 })} kWh`;

export const fmtMoney = (v: number) => v.toLocaleString('nb-NO', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

export const fmtTime = (epochSec: number) =>
  new Date(epochSec * 1000).toLocaleString('nb-NO', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/** Start på en Mill-statistikkperiode. startTimestamp er i millisekunder (ikke sekunder), så bruk ISO-feltet. */
export const statStart = (it: { startPeriod: string }) => new Date(it.startPeriod);
