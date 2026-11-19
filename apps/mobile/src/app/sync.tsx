/**
 * Synchronizace (design/navrh/MobileSync.dc.html): bez signálu + časová osa fronty, hodiny
 * telefonu proti serveru, akce čekající na odeslání; dál odmítnuté akce, reakční doba, zařízení.
 */
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { categoryShortLabel } from '@triatlon/shared';
import { formatOffset } from '../lib/clock';
import type { OutboxItem } from '../lib/outbox';
import { API_URL, dismissItem, logout, setReaction, sync, syncClock, useApp } from '../store';
import { Button, C, Card, ConfirmButton, formatClock, Muted, s, Segmented } from '../ui';

const KIND: Record<string, string> = {
  record: 'Záznam času',
  cancel: 'Vrácení akce',
  note: 'Poznámka',
  admin_correction: 'Korekce',
};

/** Kolik minut / sekund od okamžiku. */
function since(iso: string, now: number): string {
  const sec = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return sec < 60 ? `${sec} s` : `${Math.floor(sec / 60)} min`;
}

function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

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

  const offline = state.net.online === false;
  const offlineSince = state.net.offlineSince ?? pending[0]?.createdAt ?? null;
  const now = useNow();

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
  /** „č. 12 · M do 40“ pro položku fronty. */
  const label = (id: string) => {
    for (const snap of Object.values(state.snapshots)) {
      const p = snap.participants.find((x) => x.id === id);
      if (p) {
        const cat = snap.race.categories.find((c) => c.id === p.categoryId);
        return `č. ${p.bib} · ${cat ? categoryShortLabel(cat) : ''}`;
      }
    }
    return name(id);
  };

  return (
    <ScrollView contentContainerStyle={s.pad}>
      {offline && <OfflineCard since={offlineSince} pending={pending} now={now} />}

      <ClockCard />

      <Card>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <Text style={s.h2}>Čeká na odeslání</Text>
          <Muted>
            {pending.length} {pending.length === 1 ? 'akce' : pending.length < 5 ? 'akce' : 'akcí'}
          </Muted>
        </View>
        {!offline && (
          <Muted>
            {state.net.syncing ? 'Odesílám… · ' : ''}
            {state.net.lastSyncAt
              ? `Naposledy odesláno ${formatClock(state.net.lastSyncAt)}`
              : 'Spojení se serverem je v pořádku.'}
          </Muted>
        )}
        {state.net.lastError && <Muted>Poslední pokus: {state.net.lastError}</Muted>}
        {pending.length === 0 && <Muted>Vše je odeslané.</Muted>}
        {pending.slice(0, QUEUE_SHOWN).map((it) => {
          const [who, what] = queueLabel(it, label);
          return (
            <View
              key={it.id}
              style={[
                s.row,
                {
                  justifyContent: 'space-between',
                  paddingVertical: 6,
                  borderTopWidth: 1,
                  borderTopColor: C.line,
                },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[s.text, { fontWeight: '600' }]} numberOfLines={1}>
                  {who}
                </Text>
                <Muted>{what}</Muted>
              </View>
              <Text style={[s.text, { fontVariant: ['tabular-nums'] }]}>
                {formatClock(it.kind === 'event' ? it.event.ts : it.createdAt)}
              </Text>
            </View>
          );
        })}
        {pending.length > QUEUE_SHOWN && <Muted>… a dalších {pending.length - QUEUE_SHOWN}</Muted>}
        {foreign.length > 0 && (
          <Muted>
            {foreign.length} akcí zadal jiný uživatel — odešlou se, až se znovu přihlásí.
          </Muted>
        )}
      </Card>
      <Button
        big
        title={state.net.syncing ? 'Odesílám…' : 'Zkusit odeslat teď'}
        disabled={!pending.length || !user || state.net.syncing}
        onPress={() => void sync()}
      />

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
        <Text style={s.h2}>Reakční doba</Text>
        <Muted>Odečet od času klepnutí na číslo (obsluha klepne o chvilku později).</Muted>
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

const QUEUE_SHOWN = 6;

function queueLabel(it: OutboxItem, label: (id: string) => string): [string, string] {
  if (it.kind === 'status') {
    return [
      label(it.participantId),
      `Check-in: ${it.status === 'absent' ? 'nepřítomen' : 'přítomen'}`,
    ];
  }
  if (it.kind === 'register') {
    return [
      `č. ${it.registration.bib ?? '?'} · ${it.registration.lastName}`,
      'Registrace na místě',
    ];
  }
  return [label(it.event.participantId), KIND[it.event.type] ?? it.event.type];
}

/** Varování bez signálu + časová osa akcí uložených v telefonu od výpadku. */
function OfflineCard({
  since: from,
  pending,
  now,
}: {
  since: string | null;
  pending: OutboxItem[];
  now: number;
}) {
  const start = from ? Date.parse(from) : now;
  const span = Math.max(60_000, now - start);
  const pos = (iso: string) =>
    `${Math.min(100, Math.max(0, ((Date.parse(iso) - start) / span) * 100))}%` as const;
  const ticks = [0, 1 / 3, 2 / 3].map((f) => start + f * span);
  return (
    <Card style={{ backgroundColor: C.warnBg, borderColor: '#e8c66a' }}>
      <View style={[s.row, { alignItems: 'flex-start', gap: 12 }]}>
        <Text style={{ fontSize: 24, color: '#8a5300' }}>⚠</Text>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[s.h2, { color: '#7a4a00' }]}>
            Bez signálu {from ? since(from, now) : ''}
          </Text>
          <Text style={[s.text, { color: '#5c3d00' }]}>
            Zapisujte dál. Časy jsou uložené v telefonu a odešlou se samy, jakmile bude signál.
          </Text>
        </View>
      </View>
      <View style={{ gap: 4 }}>
        <View
          style={{
            height: 22,
            borderRadius: 6,
            backgroundColor: '#ffffffaa',
            position: 'relative',
          }}
        >
          {pending.map((it) => (
            <View
              key={it.id}
              style={{
                position: 'absolute',
                left: pos(it.createdAt),
                top: 4,
                bottom: 4,
                width: 3,
                marginLeft: -1,
                borderRadius: 2,
                backgroundColor: '#b06d00',
              }}
            />
          ))}
        </View>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          {ticks.map((t, i) => (
            <Text key={t} style={[s.muted, { fontVariant: ['tabular-nums'] }]}>
              {formatClock(new Date(t).toISOString()).slice(0, 5)}
              {i === 0 ? ' výpadek' : ''}
            </Text>
          ))}
          <Text style={s.muted}>teď</Text>
        </View>
      </View>
    </Card>
  );
}

/** Odchylka hodin telefonu proti serveru na stupnici −2 s … +2 s. */
function ClockCard() {
  const clock = useApp((st) => st.clock);
  const offset = clock?.offsetMs ?? null;
  // Hodiny telefonu jdou vedle o −offset (offset = server − telefon).
  const phone = offset == null ? null : -offset;
  const RANGE = 2000;
  const left = phone == null ? 50 : 50 + (Math.max(-RANGE, Math.min(RANGE, phone)) / RANGE) * 50;
  return (
    <Card>
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <Text style={s.h2}>Hodiny telefonu</Text>
        <Text style={[s.h2, { fontVariant: ['tabular-nums'] }]}>
          {phone == null ? '—' : formatOffset(phone)}
        </Text>
      </View>
      <View style={{ height: 24, justifyContent: 'center' }}>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: C.line }} />
        <View
          style={{
            position: 'absolute',
            left: '50%',
            width: 2,
            height: 16,
            marginLeft: -1,
            backgroundColor: C.muted,
          }}
        />
        {phone != null && (
          <View
            style={{
              position: 'absolute',
              left: `${left}%`,
              width: 14,
              height: 14,
              marginLeft: -7,
              borderRadius: 7,
              backgroundColor: Math.abs(phone) > 1000 ? C.warn : C.primary,
              borderWidth: 2,
              borderColor: C.card,
            }}
          />
        )}
      </View>
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <Muted>−2 s</Muted>
        <Muted>server</Muted>
        <Muted>+2 s</Muted>
      </View>
      <Muted>
        {clock
          ? `Ověřeno ${formatClock(clock.at)} (přesnost ±${Math.ceil(clock.rttMs / 2)} ms). Zapsané časy se o odchylku opraví automaticky.`
          : 'Odchylka zatím nezměřena — časy se zapisují podle hodin telefonu.'}
      </Muted>
      <Button title="Změřit znovu" kind="secondary" onPress={() => void syncClock()} />
    </Card>
  );
}
