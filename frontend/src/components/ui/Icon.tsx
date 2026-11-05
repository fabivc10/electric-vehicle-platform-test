import type { SVGProps } from 'react';

const PATHS = {
  bolt: 'M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2Z',
  session: 'M3 8h14v8H3zM17 11h2v2h-2zM6 11h5',
  charger: 'M7 3h7v18H7zM10 7h1M14 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V8l-2-2',
  history: 'M4 6h16M4 12h16M4 18h10',
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  close: 'M6 6l12 12M18 6 6 18',
  thermo: 'M10 13.5V5a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0ZM12 9v6',
  trend: 'm4 16 5-5 4 4 7-7M15 8h5v5',
  wifi: 'M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01',
  plug: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v4',
  alert: 'M12 3 2 20h20L12 3ZM12 10v4M12 17h.01',
  arrowIn: 'M19 12H5m0 0 5-5m-5 5 5 5',
  arrowOut: 'M5 12h14m0 0-5-5m5 5-5 5',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
} as const;

export type IconName = keyof typeof PATHS;

export const Icon = ({ name, size = 18, ...props }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  >
    <path d={PATHS[name]} />
  </svg>
);
