const timeFmt = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit', hour12: false });
const timeSecFmt = new Intl.DateTimeFormat('es', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
const dayFmt = new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short' });
const dateTimeFmt = new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short', hour12: false });

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const fmtTime = (iso?: string | number | Date) => (iso === undefined ? '—' : timeFmt.format(new Date(iso)));
export const fmtTimeSec = (iso?: string) => (iso ? timeSecFmt.format(new Date(iso)) : '—');
export const fmtDateTime = (iso?: string) => (iso ? dateTimeFmt.format(new Date(iso)) : '—');

/** "Jue, 5 Nov" */
export const fmtDay = (d: Date) =>
  dayFmt
    .formatToParts(d)
    .map((p) => (p.type === 'weekday' || p.type === 'month' ? capitalize(p.value.replace('.', '')) : p.value))
    .join('');

export const kw = (w?: number, digits = 1) => (w === undefined ? '—' : (w / 1000).toFixed(digits));
export const kwh = (wh?: number, digits = 2) => (wh === undefined ? '—' : (wh / 1000).toFixed(digits));
export const num = (v?: number, digits = 1) => (v === undefined ? '—' : v.toFixed(digits));

/** "hace 12 s", "hace 3 min" */
export const ago = (iso: string | undefined, now: number) => {
  if (!iso) return '—';
  const sec = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (sec < 60) return `hace ${sec} s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `hace ${min} min`;
  return `hace ${Math.round(min / 60)} h`;
};

export const durationMin = (fromIso: string, toMs: number) => Math.max(0, Math.floor((toMs - Date.parse(fromIso)) / 60_000));

export const fmtDuration = (fromIso: string, toIso?: string) => {
  const ms = (toIso ? Date.parse(toIso) : Date.now()) - Date.parse(fromIso);
  const m = Math.max(0, Math.floor(ms / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};

/** Etiqueta "CP-xxx" sin duplicar el prefijo si el id ya lo trae. */
export const cpLabel = (id?: string) => (!id ? 'CP-—' : /^cp[-_]/i.test(id) ? id : `CP-${id}`);
