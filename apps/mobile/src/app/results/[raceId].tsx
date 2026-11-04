/** Průběžné a celkové výsledky (organizátor je vidí vždy). Offline ukazuje poslední stažené. */
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { formatDuration, type ResultRow } from '@triatlon/shared';
import { cachedResults, errorText, loadResults, useApp } from '../../store';
import { Button, C, ErrorText, formatClock, Loading, Muted, s } from '../../ui';

const STATE: Record<ResultRow['state'], string> = {
  finished: 'v cíli',
  racing: 'na trati',
  not_started: 'nestartoval',
  disqualified: 'DSQ',
};

export default function Results() {
  const { raceId } = useLocalSearchParams<{ raceId: string }>();
  const live = useApp((st) => st.results[raceId]);
  const results = live ?? cachedResults(raceId);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    setBusy(true);
    loadResults(raceId)
      .then(() => setError(null))
      .catch((err) => setError(`${errorText(err)} Zobrazuji poslední stažené výsledky.`))
      .finally(() => setBusy(false));
  }, [raceId]);

  useEffect(() => {
    reload();
    const t = setInterval(reload, 20_000);
    return () => clearInterval(t);
  }, [reload]);

  if (!results) return error ? <ErrorText>{error}</ErrorText> : <Loading />;
  const categories = results.categories.filter((c) => c.counts.registered > 0);
  const category = categories.find((c) => c.categoryId === categoryId) ?? categories[0];

  return (
    <View style={s.screen}>
      <View style={{ padding: 12, gap: 8 }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 6 }}
        >
          {categories.map((c) => (
            <Pressable
              key={c.categoryId}
              onPress={() => setCategoryId(c.categoryId)}
              style={[
                {
                  borderWidth: 1,
                  borderColor: C.border,
                  borderRadius: 16,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  backgroundColor: C.card,
                },
                c.categoryId === category?.categoryId && {
                  backgroundColor: C.primary,
                  borderColor: C.primary,
                },
              ]}
            >
              <Text
                style={{
                  fontWeight: '600',
                  color: c.categoryId === category?.categoryId ? C.primaryText : C.text,
                }}
              >
                {c.name} ({c.counts.finished}/{c.counts.registered - c.counts.absent})
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <Muted>Aktualizováno {formatClock(results.generatedAt)}</Muted>
          <Button
            title={busy ? '…' : 'Obnovit'}
            kind="secondary"
            onPress={reload}
            disabled={busy}
          />
        </View>
        <ErrorText>{error}</ErrorText>
      </View>
      <FlatList
        data={category?.rows ?? []}
        keyExtractor={(r) => r.participantId}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 32 }}
        ListEmptyComponent={<Muted>Žádné výsledky.</Muted>}
        renderItem={({ item: r }) => (
          <View
            style={[
              s.row,
              { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
              r.state === 'disqualified' && { opacity: 0.5 },
            ]}
          >
            <Text style={[s.text, { width: 40, fontWeight: '800', textAlign: 'right' }]}>
              {r.rank ?? '—'}
              {r.tied ? '=' : ''}
            </Text>
            <Text style={[s.text, { width: 40, textAlign: 'right', color: C.muted }]}>{r.bib}</Text>
            <Text style={[s.text, { flex: 1 }]} numberOfLines={1}>
              {r.lastName} {r.firstName}
            </Text>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[s.text, { fontWeight: '700', fontVariant: ['tabular-nums'] }]}>
                {r.totalMs !== null
                  ? formatDuration(r.totalMs, true)
                  : r.splits.length > 1
                    ? formatDuration(r.splits.at(-1)!.elapsedMs)
                    : ''}
              </Text>
              <Text style={s.muted}>{STATE[r.state]}</Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}
