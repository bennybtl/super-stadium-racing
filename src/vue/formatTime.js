// Format a duration in milliseconds as m:ss.cc (e.g. 1:04.37). Returns an
// em dash for null/undefined so callers can pass an absent time directly.
export function formatLapTime(ms) {
  if (ms == null) return '—';
  const m  = Math.floor(ms / 60000);
  const s  = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
