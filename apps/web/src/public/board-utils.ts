/**
 * Pomocné funkce veřejné tabule a kiosku: načítání s živým kanálem, barvy disciplín, popisky
 * stavu závodníka a formátování (design_claude.md, sekce 3).
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  currentLeg,
  lastPassed,
  type PublicCategoryDto,
  type PublicRaceResultsDto,
  type PublicResultRowDto,
} from '@triatlon/shared';

export async function publicGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api/public${path}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Chyba ${res.status}`);
  }
  return (await res.json()) as T;
}

/** Výsledky závodu + živý kanál (EventSource): při změně se načtou znovu. */
export function usePublicResults(raceId: string) {
  const queryClient = useQueryClient();
  const [live, setLive] = useState(false);
  const results = useQuery({
    queryKey: ['public', raceId],
    queryFn: () => publicGet<PublicRaceResultsDto>(`/races/${raceId}/results`),
    // Názvy disciplín s velkým písmenem (legenda, záhlaví sloupců).
    select: (d) => ({
      ...d,
      disciplines: d.disciplines.map((x) => ({
        ...x,
        name: x.name.charAt(0).toLocaleUpperCase('cs') + x.name.slice(1),
      })),
    }),
    // Pojistka, kdyby živý kanál vypadl (mobilní data diváků).
    refetchInterval: 60_000,
  });
  useEffect(() => {
    const es = new EventSource(`/api/public/races/${raceId}/stream`);
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ['public', raceId] });
    es.onopen = () => {
      setLive(true);
      refresh();
    };
    es.onerror = () => setLive(false);
    es.addEventListener('results', refresh);
    return () => es.close();
  }, [raceId, queryClient]);
  return { results, live };
}

/** Barva disciplíny podle pořadí na trati (plavání, kolo, běh; další se opakují). */
export const disciplineVar = (i: number) => `var(--leg-${i % 3})`;

/** Co závodník právě dělá, podle názvu disciplíny („Na kole“). */
function doing(discipline: string | undefined): string {
  const n = (discipline ?? '').toLocaleLowerCase('cs');
  if (n.includes('plav')) return 'Plave';
  if (n.includes('kol') || n.includes('cykl')) return 'Na kole';
  if (n.includes('běh') || n.includes('beh')) return 'Běží';
  return discipline ? `Úsek ${discipline.toLocaleLowerCase('cs')}` : 'Na trati';
}

export const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString('cs-CZ', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });

/** Popisek stavu pod jménem: kde je závodník na trati / proč nemá pořadí. */
export function stateText(
  row: PublicResultRowDto,
  category: PublicCategoryDto,
  data: PublicRaceResultsDto,
): string {
  const disciplines = data.disciplines.map((d) => d.name);
  switch (row.state) {
    case 'racing': {
      const k = lastPassed(row);
      const cp = data.checkpoints.find((c) => c.id === category.checkpointIds[k]);
      const at =
        k > 0 && row.startedAt && row.splitsMs[k] != null
          ? ` · ${cp?.name ?? 'checkpoint'} v ${clock(Date.parse(row.startedAt) + row.splitsMs[k]!)}`
          : k === 0
            ? ' · odstartoval'
            : '';
      return `${doing(disciplines[currentLeg(row)])}${at}`;
    }
    case 'dnf': {
      const d = disciplines[currentLeg(row)];
      return d ? `Nedokončil (${d.toLocaleLowerCase('cs')})` : 'Nedokončil';
    }
    case 'not_started':
      return 'Nestartoval';
    case 'disqualified':
      return 'Diskvalifikován';
    default:
      return '';
  }
}

/** Délky tratí: „Plavání 400 m · Kolo 12 km · Běh 4 km“. */
export function distancesText(category: PublicCategoryDto): string {
  const d = category.distances;
  if (!d) return '';
  const m = (v: number) =>
    v >= 1000 ? `${(v / 1000).toLocaleString('cs', { maximumFractionDigits: 1 })} km` : `${v} m`;
  return [
    d.swim ? `Plavání ${m(d.swim)}` : '',
    d.bike ? `Kolo ${m(d.bike)}` : '',
    d.run ? `Běh ${m(d.run)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** „Aktualizováno před N s“ z času výpočtu výsledků. */
export function agoText(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `před ${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `před ${m} min` : `v ${clock(Date.parse(iso))}`;
}
