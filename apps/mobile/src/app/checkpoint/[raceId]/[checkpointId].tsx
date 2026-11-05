/** Obrazovka checkpointu: grid čísel; na startu navíc hromadný start, check-in a registrace. */
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { startCheckpointId } from '@triatlon/shared';
import { Grid } from '../../../components/Grid';
import { CheckInPanel, RegisterPanel, StartPanel } from '../../../components/StartPanels';
import { checkpointEntries, localParticipants } from '../../../lib/view';
import { refreshRace, setActiveRace, snapshotOf, useApp } from '../../../store';
import { Loading, Muted, s, Segmented } from '../../../ui';

type Tab = 'start' | 'checkin' | 'register' | 'grid';

export default function CheckpointScreen() {
  const { raceId, checkpointId } = useLocalSearchParams<{ raceId: string; checkpointId: string }>();
  const snapshot = useApp((st) => st.snapshots[raceId]);
  const outbox = useApp((st) => st.outbox);
  const userId = useApp((st) => st.session?.user.id ?? '');
  const [tab, setTab] = useState<Tab>('start');

  useEffect(() => {
    snapshotOf(raceId);
    setActiveRace(raceId);
    void refreshRace(raceId).catch(() => undefined);
    return () => setActiveRace(null);
  }, [raceId]);

  const view = useMemo(
    () => (snapshot ? checkpointEntries(snapshot, outbox, checkpointId, userId) : null),
    [snapshot, outbox, checkpointId, userId],
  );
  const participants = useMemo(
    () => (snapshot ? localParticipants(snapshot, outbox) : []),
    [snapshot, outbox],
  );

  if (!snapshot || !view) return <Loading />;
  const race = snapshot.race;
  const checkpoint = race.checkpoints.find((c) => c.id === checkpointId);
  if (!checkpoint) return <Muted>Checkpoint v závodě neexistuje.</Muted>;
  const isStart = startCheckpointId(race.checkpoints) === checkpointId;
  const allowed = race.myCheckpointIds.includes(checkpointId);
  const categories = race.categories.filter((c) => c.checkpointIds.includes(checkpointId));

  return (
    <View style={s.screen}>
      <Stack.Screen options={{ title: checkpoint.name }} />
      {!allowed && (
        <View style={{ padding: 12 }}>
          <Muted>Na tento checkpoint už nejste přiřazen — zápisy server odmítne.</Muted>
        </View>
      )}
      {isStart && (
        <View style={{ paddingHorizontal: 12, paddingTop: 12 }}>
          <Segmented
            value={tab}
            options={[
              { value: 'start', label: 'Start' },
              { value: 'checkin', label: 'Check-in' },
              { value: 'register', label: 'Registrace' },
            ]}
            onChange={setTab}
          />
        </View>
      )}
      {!isStart || tab === 'grid' ? (
        <Grid
          raceId={raceId}
          checkpointId={checkpointId}
          entries={view.entries}
          categories={categories}
          hidden={view.hidden}
          notStarted={view.notStarted}
          closed={view.closed}
        />
      ) : tab === 'start' ? (
        <StartPanel raceId={raceId} checkpointId={checkpointId} entries={view.entries} />
      ) : tab === 'checkin' ? (
        <CheckInPanel
          raceId={raceId}
          snapshot={snapshot}
          participants={participants}
          checkpointId={checkpointId}
        />
      ) : (
        <RegisterPanel raceId={raceId} snapshot={snapshot} participants={participants} />
      )}
    </View>
  );
}
