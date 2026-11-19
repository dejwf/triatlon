/** Čas dne v místním čase, např. „8:03:12.4“. */
export function formatClock(iso: string | null, tenths = true): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const hms = d.toLocaleTimeString('cs-CZ', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
  return tenths ? `${hms}.${Math.floor(d.getMilliseconds() / 100)}` : hms;
}

/** Hodnota pro <input type="time" step="0.1">: „HH:MM:SS.s“. */
export function toTimeInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${Math.floor(d.getMilliseconds() / 100)}`;
}

/** Hodnota pro <input type="date">: „YYYY-MM-DD“ v místním čase. */
export function toDateInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Den („YYYY-MM-DD“) a čas dne zadané adminem (místní čas) → ISO. Null = neplatný vstup. */
export function parseClock(day: string, value: string): string | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,3}))?)?$/.exec(value.trim());
  if (!m) return null;
  const [, h, min, s = '0', frac = '0'] = m;
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!dm) return null;
  const [y, mo, d] = dm.slice(1).map(Number);
  const date = new Date(
    y!,
    mo! - 1,
    d!,
    Number(h),
    Number(min),
    Number(s),
    Number(frac.padEnd(3, '0')),
  );
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
