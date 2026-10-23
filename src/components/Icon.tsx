import type { SVGProps } from 'react';

// Enkle strek-ikoner (24×24, 1,75 strek, currentColor) – følger tekstfarge og mørk modus.
const PATHS = {
  flame: 'M12 3c.5 3-2 4.5-2 7.5a2 2 0 0 0 4 0c0-.8-.3-1.5-.6-2C16 10 17 12.5 17 14.5a5 5 0 0 1-10 0C7 10 11 8 12 3Z',
  droplet: 'M12 3.5c3 3.6 5.5 6.6 5.5 10a5.5 5.5 0 0 1-11 0c0-3.4 2.5-6.4 5.5-10Z',
  bolt: 'M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z',
  pencil: 'M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4',
  close: 'M6 6l12 12M18 6 6 18',
  minus: 'M5 12h14',
  plus: 'M12 5v14M5 12h14',
  'chevron-left': 'M15 5l-7 7 7 7',
  'chevron-right': 'M9 5l7 7-7 7',
  thermometer: 'M10 4a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0V4Z',
  window: 'M5 4h14v16H5zM12 4v16M5 12h14',
  plug: 'M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0V8ZM12 16v5',
  play: 'M8 5.5v13l10-6.5-10-6.5Z',
  pause: 'M9 5v14M15 5v14',
  next: 'M6 5.5v13l9-6.5-9-6.5ZM18 5v14',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z',
} as const;

export type IconName = keyof typeof PATHS;

/** Minimalistisk strek-ikon. Størrelse følger font-size (1em) med mindre `size` er satt. */
export function Icon({ name, size, ...rest }: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      className="icon-svg"
      viewBox="0 0 24 24"
      width={size ?? '1em'}
      height={size ?? '1em'}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
