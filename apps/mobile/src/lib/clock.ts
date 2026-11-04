/**
 * Synchronizace hodin s serverem. Časy zapisuje telefon, a ten může mít hodiny rozjeté o
 * sekundy i minuty — appka si proto měří offset vůči `GET /api/time` a do akcí zapisuje
 * opravený čas (`Date.now() + offset`).
 */
export interface ClockSample {
  /** Lokální čas odeslání požadavku (ms). */
  sentAt: number;
  /** Čas serveru z odpovědi (ms). */
  serverTime: number;
  /** Lokální čas přijetí odpovědi (ms). */
  receivedAt: number;
}

export interface ClockEstimate {
  /** O kolik ms jdou hodiny serveru napřed oproti telefonu. */
  offsetMs: number;
  /** Doba odezvy nejlepšího vzorku — nejistota odhadu je zhruba polovina. */
  rttMs: number;
}

/**
 * Odhad podle vzorku s nejkratší odezvou (jako NTP): server odpověděl zhruba v polovině
 * cesty, takže offset = čas serveru − střed intervalu odeslání/přijetí.
 */
export function estimateOffset(samples: readonly ClockSample[]): ClockEstimate | null {
  const valid = samples.filter((s) => s.receivedAt >= s.sentAt && Number.isFinite(s.serverTime));
  if (!valid.length) return null;
  const best = valid.reduce((a, b) => (b.receivedAt - b.sentAt < a.receivedAt - a.sentAt ? b : a));
  return {
    offsetMs: Math.round(best.serverTime - (best.sentAt + best.receivedAt) / 2),
    rttMs: best.receivedAt - best.sentAt,
  };
}

/** Čitelně: „+1,2 s“, „−0,3 s“. */
export function formatOffset(ms: number): string {
  const s = (Math.abs(ms) / 1000).toFixed(1).replace('.', ',');
  return `${ms < 0 ? '−' : '+'}${s} s`;
}
