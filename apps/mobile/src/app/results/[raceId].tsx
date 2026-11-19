/**
 * Průběžné a celkové výsledky (design/navrh/MobileResults.dc.html): domácí a hosté téže věkové
 * skupiny a pohlaví v jedné tabulce (jako veřejná tabule), karty s mini pruhem rozložení času,
 * pořadím v kategorii a ztrátou. Ředitel závodu tu kategorii uzavírá. Offline ukazuje poslední
 * stažené výsledky.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import {
  barScaleMs,
  currentLeg,
  disciplineMedians,
  estimatedRestMs,
  formatDuration,
  gapMs,
  lastPassed,
  rankCombined,
  type BoardRow,
  type CategoryResultsDto,
  type Locality,
  type RaceDetailDto,
  type RaceResultsDto,
  type ResultRow,
} from '@triatlon/shared';
import {
  api,
  cachedResults,
  errorText,
  loadResults,
  refreshRace,
  snapshotOf,
  useApp,
} from '../../store';
import {
  C,
  ConfirmButton,
  ErrorText,
  formatClock,
  Loading,
  LocBadge,
  MiniBar,
  Muted,
  s,
} from '../../ui';

type Row = ResultRow &
  BoardRow & { locality: Locality; categoryRank: number | null; categoryTied: boolean };

interface Table {
  key: string;
  name: string;
  categories: CategoryResultsDto[];
  checkpointIds: string[];
  rows: Row[];
}

/** Společné tabulky (věková skupina + pohlaví); bez dat o závodu jednotlivé kategorie. */
function buildTables(results: RaceResultsDto, race: RaceDetailDto | undefined): Table[] {
  const shown = results.categories.filter((c) => c.counts.registered > 0);
  const meta = new Map(race?.categories.map((c) => [c.id, c]) ?? []);
  const seq = new Map(race?.checkpoints.map((c) => [c.id, c.seq]) ?? []);
  const toRows = (c: CategoryResultsDto, checkpointIds: string[]): Row[] =>
    c.rows.map((r) => {
      const at = new Map(r.splits.map((x) => [x.checkpointId, x.elapsedMs]));
      return {
        ...r,
        locality: meta.get(c.categoryId)?.locality ?? 'local',
        categoryRank: r.rank,
        categoryTied: r.tied,
        splitsMs: checkpointIds.map((id) => at.get(id) ?? null),
        disciplinesMs: r.disciplines.map((d) => d.ms),
      };
    });
  if (!race) {
    return shown.map((c) => ({
      key: c.categoryId,
      name: c.name,
      categories: [c],
      checkpointIds: c.checkpointIds,
      rows: toRows(c, c.checkpointIds),
    }));
  }
  const groups = new Map<string, CategoryResultsDto[]>();
  for (const cat of race.categories) {
    const c = shown.find((x) => x.categoryId === cat.id);
    if (!c) continue;
    const key = `${cat.ageGroupLabel}|${cat.gender}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups].map(([key, cats]) => {
    const checkpointIds = [...new Set(cats.flatMap((c) => c.checkpointIds))].sort(
      (a, b) => (seq.get(a) ?? 0) - (seq.get(b) ?? 0),
    );
    const rows = rankCombined(
      cats.flatMap((c) => toRows(c, checkpointIds)),
      race.checkpoints,
      cats.flatMap((c) => c.overrides),
    );
    return {
      key,
      name: meta.get(cats[0]!.categoryId)?.groupName ?? cats[0]!.name,
      categories: cats,
      checkpointIds,
      rows,
    };
  });
}

function doing(discipline: string | undefined): string {
  const n = (discipline ?? '').toLocaleLowerCase('cs');
  if (n.includes('plav')) return 'Plave';
  if (n.includes('kol') || n.includes('cykl')) return 'Na kole';
  if (n.includes('běh') || n.includes('beh')) return 'Běží';
  return 'Na trati';
}

export default function Results() {
  const { raceId } = useLocalSearchParams<{ raceId: string }>();
  const live = useApp((st) => st.results[raceId]);
  const race = useApp((st) => st.snapshots[raceId]?.race) ?? snapshotOf(raceId)?.race;
  const results = live ?? cachedResults(raceId);
  const [tableKey, setTableKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(() => {
    loadResults(raceId)
      .then(() => setError(null))
      .catch((err) => setError(`${errorText(err)} Zobrazuji poslední stažené výsledky.`));
  }, [raceId]);

  useEffect(() => {
    reload();
    const t = setInterval(reload, 20_000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(t);
      clearInterval(tick);
    };
  }, [reload]);

  const tables = useMemo(() => (results ? buildTables(results, race) : []), [results, race]);

  if (!results) return error ? <ErrorText>{error}</ErrorText> : <Loading />;
  const table = tables.find((t) => t.key === tableKey) ?? tables[0];
  const rows = table?.rows ?? [];
  const scale = barScaleMs(rows);
  const medians = disciplineMedians(rows);
  const combined = (table?.categories.length ?? 0) > 1;
  const finished = rows.filter((r) => r.state === 'finished').length;
  const racing = rows.filter((r) => r.state === 'racing').length;
  const dnf = rows.filter((r) => r.state === 'dnf').length;
  const cpName = new Map(race?.checkpoints.map((c) => [c.id, c.name]) ?? []);
  const legNames = race?.disciplines.map((d) => d.name) ?? [];
  const ageS = Math.max(0, Math.round((now - Date.parse(results.generatedAt)) / 1000));

  const sub = (r: Row): string => {
    if (r.state === 'finished') {
      return r.categoryRank
        ? `Pořadí v kategorii ${combined ? (r.locality === 'local' ? 'D ' : 'H ') : ''}${r.categoryRank}.${r.categoryTied ? '=' : ''}`
        : '';
    }
    if (r.state === 'racing') {
      const k = lastPassed(r);
      const split = r.splits.find((x) => x.checkpointId === table?.checkpointIds[k]);
      const at =
        k > 0 && split ? ` · ${cpName.get(split.checkpointId)} v ${formatClock(split.ts)}` : '';
      return `${doing(legNames[currentLeg(r)])}${at}`;
    }
    if (r.state === 'dnf') {
      const d = legNames[currentLeg(r)];
      return d ? `Nedokončil (${d.toLocaleLowerCase('cs')})` : 'Nedokončil';
    }
    return r.state === 'disqualified' ? 'Diskvalifikován' : 'Nestartoval';
  };

  return (
    <View style={s.screen}>
      <View style={{ padding: 12, gap: 10 }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 6 }}
        >
          {tables.map((t) => {
            const active = t.key === table?.key;
            const closed = t.categories.every((c) => c.closedAt);
            return (
              <Pressable
                key={t.key}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setTableKey(t.key)}
                style={[chip, active && { backgroundColor: C.primary, borderColor: C.primary }]}
              >
                <Text style={{ fontWeight: '600', color: active ? C.primaryText : C.text }}>
                  {closed ? '✓ ' : ''}
                  {t.name} ({t.rows.length})
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <View style={[s.row, { gap: 6 }]}>
            <Pill n={finished} label="v cíli" color={C.ok} bg={C.okBg} />
            <Pill n={racing} label="na trati" color={C.info} bg={C.infoBg} />
            <Pill n={dnf} label="DNF" color={C.muted} bg={C.done} />
          </View>
          <Pressable onPress={reload} hitSlop={8} accessibilityRole="button">
            <Muted>
              {error ? 'offline' : 'živě'} · před{' '}
              {ageS < 60 ? `${ageS} s` : `${Math.floor(ageS / 60)} min`} ↻
            </Muted>
          </Pressable>
        </View>
        <ErrorText>{error}</ErrorText>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.participantId}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 16, gap: 6 }}
        ListEmptyComponent={<Muted>Žádné výsledky.</Muted>}
        renderItem={({ item: r, index }) => {
          const done = r.state === 'finished';
          const gap = gapMs(r, rows);
          return (
            <View
              style={[
                card,
                index === 0 && done && { borderColor: '#9cc6f0' },
                (r.state === 'dnf' || r.state === 'disqualified') && { opacity: 0.7 },
              ]}
            >
              <Text
                style={{
                  width: 40,
                  fontWeight: '800',
                  fontSize: done ? 18 : 12,
                  color: r.state === 'dnf' ? C.danger : done ? C.text : C.muted,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {r.state === 'dnf'
                  ? 'DNF'
                  : r.rank === null
                    ? '–'
                    : done
                      ? `${r.rank}.${r.tied ? '=' : ''}`
                      : `(${r.rank}.)`}
              </Text>
              <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
                <View style={[s.row, { gap: 6 }]}>
                  <Text
                    style={{ fontWeight: '700', color: C.muted, fontVariant: ['tabular-nums'] }}
                  >
                    {r.bib}
                  </Text>
                  <Text style={[s.text, { fontWeight: '600', flexShrink: 1 }]} numberOfLines={1}>
                    {r.displayName}
                  </Text>
                  {combined && <LocBadge local={r.locality === 'local'} />}
                </View>
                <MiniBar legs={r.disciplinesMs} scale={scale} rest={estimatedRestMs(r, medians)} />
                <Text style={s.muted} numberOfLines={1}>
                  {sub(r)}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[s.text, { fontWeight: '800', fontVariant: ['tabular-nums'] }]}>
                  {done ? formatDuration(r.totalMs) : r.state === 'racing' ? 'na trati' : ''}
                </Text>
                <Text style={[s.muted, { fontVariant: ['tabular-nums'] }]}>
                  {gap ? `+${formatDuration(gap)}` : ''}
                </Text>
              </View>
            </View>
          );
        }}
      />
      {table && race && (
        <CloseTable raceId={raceId} table={table} isDirector={race.isDirector} onDone={reload} />
      )}
    </View>
  );
}

function Pill({ n, label, color, bg }: { n: number; label: string; color: string; bg: string }) {
  return (
    <View style={[s.badge, s.row, { backgroundColor: bg, gap: 4 }]}>
      <Text style={{ fontWeight: '800', color, fontVariant: ['tabular-nums'] }}>{n}</Text>
      <Text style={{ fontSize: 13, color }}>{label}</Text>
    </View>
  );
}

/**
 * Ředitel závodu uzavře tabulku (domácí i hosty): výsledky se stanou oficiálními, kdo je na
 * trati, je DNF. Znovuotevření s důvodem. Jen online — rozhodnutí musí server potvrdit hned.
 */
function CloseTable({
  raceId,
  table,
  isDirector,
  onDone,
}: {
  raceId: string;
  table: Table;
  isDirector: boolean;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onCourse = table.rows.filter((r) => r.state === 'racing');
  const closed = table.categories.every((c) => c.closedAt);
  const started = table.categories.filter((c) => c.startedAt);

  async function run(action: 'close' | 'reopen') {
    setBusy(true);
    setError(null);
    try {
      const targets = table.categories.filter((c) =>
        action === 'close' ? !c.closedAt && c.startedAt : c.closedAt,
      );
      for (const c of targets) {
        await api(
          'POST',
          `/races/${raceId}/categories/${c.categoryId}/${action}`,
          action === 'reopen' ? { reason } : undefined,
        );
      }
      setReason('');
      onDone();
      await refreshRace(raceId);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (closed) {
    const at = table.categories
      .map((c) => c.closedAt!)
      .sort()
      .at(-1)!;
    return (
      <View style={[footer, { backgroundColor: C.okBg }]}>
        <Text style={[s.text, { color: C.ok, fontWeight: '600' }]}>
          ✓ Oficiální výsledky — uzavřeno {formatClock(at)}
        </Text>
        {isDirector && (
          <>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="Důvod znovuotevření"
              placeholderTextColor={C.muted}
              style={[s.input, { paddingVertical: 8 }]}
            />
            <ConfirmButton
              kind="secondary"
              title="Znovu otevřít"
              confirmTitle="Opravdu otevřít?"
              disabled={busy || reason.trim().length < 3}
              onConfirm={() => void run('reopen')}
            />
          </>
        )}
        <ErrorText>{error}</ErrorText>
      </View>
    );
  }
  return (
    <View style={footer}>
      <ConfirmButton
        title="Uzavřít kategorii"
        confirmTitle={
          onCourse.length ? `Uzavřít? ${onCourse.length}× DNF` : 'Opravdu uzavřít kategorii?'
        }
        kind={onCourse.length ? 'secondary' : 'primary'}
        disabled={!isDirector || busy || started.length === 0}
        onConfirm={() => void run('close')}
      />
      <Muted>
        {!isDirector
          ? 'Jen ředitel závodu'
          : started.length === 0
            ? 'Kategorie ještě nestartovala'
            : onCourse.length
              ? `Na trati ${onCourse.length === 1 ? 'je ještě 1 závodník' : `jsou ještě ${onCourse.length} závodníci`} (č. ${onCourse.map((r) => r.bib).join(', ')}) — po uzavření budou DNF.`
              : 'Všichni doběhli — kategorii lze uzavřít.'}
      </Muted>
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

const chip = {
  borderWidth: 1,
  borderColor: C.border,
  borderRadius: 999,
  paddingHorizontal: 12,
  paddingVertical: 7,
  backgroundColor: C.card,
};
const card = {
  flexDirection: 'row' as const,
  gap: 10,
  alignItems: 'center' as const,
  backgroundColor: C.card,
  borderWidth: 1,
  borderColor: '#e2e6ea',
  borderRadius: 12,
  paddingVertical: 9,
  paddingHorizontal: 12,
};
const footer = {
  gap: 6,
  padding: 12,
  paddingBottom: 20,
  borderTopWidth: 1,
  borderTopColor: C.border,
  backgroundColor: C.card,
};
