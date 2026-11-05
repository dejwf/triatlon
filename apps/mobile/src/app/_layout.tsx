import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { init, startLoop, syncClock, useApp } from '../store';
import { C, Loading, SyncBadge } from '../ui';

export default function RootLayout() {
  const ready = useApp((s) => s.ready);
  const loggedIn = useApp((s) => !!s.session);

  useEffect(() => {
    void init().then(() => void syncClock());
    return startLoop();
  }, []);

  if (!ready) return <Loading />;

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: C.card },
          headerTintColor: C.text,
          contentStyle: { backgroundColor: C.bg },
          headerRight: loggedIn ? () => <SyncBadge /> : undefined,
        }}
      >
        {/* Bez přihlášení je dostupné jen přihlášení — jinak by appka na telefonu mohla
            otevřít jinou nechráněnou obrazovku místo něj. */}
        <Stack.Protected guard={!loggedIn}>
          <Stack.Screen name="login" options={{ title: 'Přihlášení', headerRight: undefined }} />
        </Stack.Protected>
        <Stack.Protected guard={loggedIn}>
          <Stack.Screen name="index" options={{ title: 'Vlkančický triatlon' }} />
          <Stack.Screen
            name="checkpoint/[raceId]/[checkpointId]"
            options={{ title: 'Checkpoint' }}
          />
          <Stack.Screen name="results/[raceId]" options={{ title: 'Výsledky' }} />
          <Stack.Screen name="sync" options={{ title: 'Synchronizace a zařízení' }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}
