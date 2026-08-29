import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 18) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const });

export function RadarIcon({ size, ...p }: IconProps) { return <svg {...base(size)} {...p}><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 12 18 7"/><path d="M12 4v2M20 12h-2M12 20v-2M4 12h2"/></svg>; }
export function MessageIcon({ size, ...p }: IconProps) { return <svg {...base(size)} {...p}><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>; }
export function UsersIcon({ size, ...p }: IconProps) { return <svg {...base(size)} {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>; }
export function ChartIcon({ size, ...p }: IconProps) { return <svg {...base(size)} {...p}><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/></svg>; }
export function CheckIcon({ size, ...p }: IconProps) { return <svg {...base(size)} {...p}><path d="m5 12 4 4L19 6"/></svg>; }
export function ClockIcon({ size, ...p }: IconProps) { return <svg {...base(size)} {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>; }
export function ArrowIcon({ size, ...p }: IconProps) { return <svg {...base(size)} {...p}><path d="M5 12h14M13 6l6 6-6 6"/></svg>; }
export function RefreshIcon({ size, ...p }: IconProps) { return <svg {...base(size)} {...p}><path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M5.6 9A7 7 0 0 1 18 6l2 5M4 13l2 5a7 7 0 0 0 12.4-3"/></svg>; }
export function SparkIcon({ size, ...p }: IconProps) { return <svg {...base(size)} {...p}><path d="m12 3 1.8 4.8L19 10l-5.2 2.2L12 17l-1.8-4.8L5 10l5.2-2.2z"/><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/></svg>; }
