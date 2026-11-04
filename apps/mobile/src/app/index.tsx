/** Výběr závodu a checkpointu — nabízí jen checkpointy, ke kterým je organizátor přiřazen. */
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { startCheckpointId } from '@triatlon/shared';
import { errorText, loadRaces, refreshRace, snapshotOf, useApp } from '../store';
import { Button, C, Card, ErrorText, Loading, Muted, s } from '../ui';

const STATUS: Record<string, string> = {
  planned: 'plánovaný',
  running: 'probíhá',
  finished: 'dokončen',
};

export default function Home() {
  const races = useApp((st) => st.races);
  const user = useApp((st) => st.session?.user);
  const snapshots = useApp((st) => st.snapshots);
  const [raceId, setRaceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadRaces().catch((err) => setError(errorText(err)));
  }, []);

  // Jediný závod rovnou vybrat.
  useEffect(() => {
    if (!raceId && races?.length === 1) setRaceId(races[0]!.id);
  }, [races, raceId]);

  useEffect(() => {
    if (!raceId) return;
    snapshotOf(raceId);
    setLoading(true);
    setError(null);
    refreshRace(raceId)
      .catch((err) => setError(`${errorText(err)} Zobrazuji uložená data.`))
      .finally(() => setLoading(false));
  }, [raceId]);

  const snapshot = raceId ? snapshots[raceId] : undefined;
  const race = snapshot?.race;
  const start = race ? startCheckpointId(race.checkpoints) : null;
  const mine = race ? race.checkpoints.filter((c) => race.myCheckpointIds.includes(c.id)) : [];

  return (
    <ScrollView contentContainerStyle={s.pad}>
      <Muted>Přihlášen: {user?.name}</Muted>
      {!races && !error && <Loading />}
      {races?.length === 0 && (
        <Muted>Nejste přiřazen k žádnému závodu. Obraťte se na admina.</Muted>
      )}
      {races && races.length > 1 && (
        <Card>
          <Text style={s.h2}>Závod</Text>
          {races.map((r) => (
            <Pressable
              key={r.id}
              onPress={() => setRaceId(r.id)}
              style={[
                { padding: 12, borderRadius: 8, borderWidth: 1, borderColor: C.border },
                r.id === raceId && { borderColor: C.primary, backgroundColor: '#e8f1fb' },
              ]}
            >
              <Text style={s.text}>
                {r.name} {r.year}
              </Text>
              <Muted>
                {r.date} · {STATUS[r.status]} · {r.participantCount} závodníků
              </Muted>
            </Pressable>
          ))}
        </Card>
      )}
      <ErrorText>{error}</ErrorText>
      {raceId && !race && loading && <Loading />}
      {race && (
        <Card>
          <Text style={s.h2}>
            {race.name} {race.year}
          </Text>
          <Muted>Kde stojíte? Zapisovat můžete jen na přiřazených checkpointech.</Muted>
          {mine.length === 0 && <Muted>K žádnému checkpointu nejste přiřazen.</Muted>}
          {mine.map((c) => (
            <Button
              key={c.id}
              big
              title={c.id === start ? `${c.name} — check-in a start` : c.name}
              kind={c.kind === 'intermediate' ? 'secondary' : 'primary'}
              onPress={() => router.push(`/checkpoint/${race.id}/${c.id}`)}
            />
          ))}
          <View style={{ height: 4 }} />
          <Button
            title="Výsledky"
            kind="secondary"
            onPress={() => router.push(`/results/${race.id}`)}
          />
        </Card>
      )}
    </ScrollView>
  );
}
