/** Stav synchronizace: čekající, odmítnuté a upozornění; hodiny, reakční doba, zařízení, odhlášení. */
import { ScrollView, Text, View } from 'react-native';
import { formatOffset } from '../lib/clock';
import type { OutboxItem } from '../lib/outbox';
import { API_URL, dismissItem, logout, setReaction, sync, syncClock, useApp } from '../store';
import { Button, C, Card, ConfirmButton, formatClock, Muted, s, Segmented } from '../ui';

const REACTIONS = [
  { value: '0', label: '0 s' },
  { value: '300', label: '0,3 s' },
  { value: '500', label: '0,5 s' },
  { value: '1000', label: '1 s' },
];

function describe(it: OutboxItem, name: (id: string) => string): string {
  if (it.kind === 'status')
    return `Check-in ${name(it.participantId)}: ${it.status === 'absent' ? 'nepřítomen' : 'přítomen'}`;
  if (it.kind === 'register')
    return `Registrace ${it.registration.lastName} ${it.registration.firstName} (č. ${it.registration.bib ?? '?'})`;
  const label = {
    record: 'Čas',
    cancel: 'Vrácení akce',
    note: 'Poznámka',
    admin_correction: 'Korekce',
  }[it.event.type];
  return `${label} ${name(it.event.participantId)} ${formatClock(it.event.ts)}`;
}

export default function SyncScreen() {
  const state = useApp((st) => st);
  const user = state.session?.user;
  const mine = state.outbox.filter((i) => !user || i.userId === user.id);
  const pending = mine.filter((i) => i.state === 'pending');
  const problems = state.outbox.filter((i) => i.state === 'rejected' || i.warning);
  const foreign = state.outbox.filter((i) => i.state === 'pending' && user && i.userId !== user.id);

  const name = (id: string) => {
    for (const snap of Object.values(state.snapshots)) {
      const p = snap.participants.find((x) => x.id === id);
      if (p) return `č. ${p.bib} ${p.lastName}`;
    }
    const reg = state.outbox.find((i) => i.kind === 'register' && i.registration.id === id);
    return reg && reg.kind === 'register'
      ? `č. ${reg.registration.bib} ${reg.registration.lastName}`
      : '?';
  };

  return (
    <ScrollView contentContainerStyle={s.pad}>
      <Card>
        <Text style={s.h2}>Fronta akcí</Text>
        <Text style={s.text}>
          {state.net.online === false ? '○ Bez spojení' : '● Spojení se serverem'}
          {state.net.syncing ? ' · odesílám…' : ''}
        </Text>
        <Muted>
          Čeká na odeslání: {pending.length}
          {state.net.lastSyncAt ? ` · naposledy odesláno ${formatClock(state.net.lastSyncAt)}` : ''}
        </Muted>
        {state.net.lastError && <Muted>Poslední pokus: {state.net.lastError}</Muted>}
        <Button
          title="Odeslat teď"
          disabled={!pending.length || !user}
          onPress={() => void sync()}
        />
        {pending.slice(0, 50).map((it) => (
          <Text key={it.id} style={s.muted}>
            ⏳ {describe(it, name)}
          </Text>
        ))}
        {foreign.length > 0 && (
          <Muted>
            {foreign.length} akcí zadal jiný uživatel — odešlou se, až se znovu přihlásí.
          </Muted>
        )}
      </Card>

      {problems.length > 0 && (
        <Card style={{ borderColor: C.danger }}>
          <Text style={s.h2}>Vyžaduje pozornost</Text>
          {problems.map((it) => (
            <View
              key={it.id}
              style={{
                gap: 4,
                paddingVertical: 6,
                borderBottomWidth: 1,
                borderBottomColor: C.border,
              }}
            >
              <Text style={s.text}>{describe(it, name)}</Text>
              <Text style={{ color: it.state === 'rejected' ? C.danger : C.warn }}>
                {it.state === 'rejected' ? `Odmítnuto: ${it.error}` : `⚠ ${it.warning}`}
              </Text>
              <Button title="Beru na vědomí" kind="secondary" onPress={() => dismissItem(it.id)} />
            </View>
          ))}
        </Card>
      )}

      <Card>
        <Text style={s.h2}>Hodiny</Text>
        <Muted>
          {state.clock
            ? `Odchylka od serveru ${formatOffset(state.clock.offsetMs)} (přesnost ±${Math.ceil(state.clock.rttMs / 2)} ms), změřeno ${formatClock(state.clock.at)}. Zapisované časy se opravují automaticky.`
            : 'Odchylka hodin zatím nezměřena — časy se zapisují podle hodin telefonu.'}
        </Muted>
        <Button title="Změřit znovu" kind="secondary" onPress={() => void syncClock()} />
        <Text style={s.label}>Odečet reakční doby při klepnutí na číslo</Text>
        <Segmented
          value={String(state.reactionMs)}
          options={REACTIONS}
          onChange={(v) => setReaction(Number(v))}
        />
      </Card>

      <Card>
        <Text style={s.h2}>Zařízení</Text>
        <Muted>Uživatel: {user ? `${user.name} (${user.email})` : 'nepřihlášen'}</Muted>
        <Muted>ID zařízení: {state.deviceId}</Muted>
        <Muted>Server: {API_URL}</Muted>
        {user && (
          <ConfirmButton
            kind="secondary"
            title="Odhlásit"
            confirmTitle={
              pending.length
                ? `${pending.length} akcí neodesláno! Přesto odhlásit?`
                : 'Opravdu odhlásit?'
            }
            onConfirm={() => void logout()}
          />
        )}
      </Card>
    </ScrollView>
  );
}
