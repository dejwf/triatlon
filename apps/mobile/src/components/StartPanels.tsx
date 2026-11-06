/**
 * Obrazovky organizátora na startu (CLAUDE.md, sekce 5 body 5–6): hromadný start kategorie
 * s pozdním startem jednotlivců, check-in (nepřítomní) a registrace na místě.
 */
import { useMemo, useState } from 'react';
import { FlatList, ScrollView, Text, TextInput, View } from 'react-native';
import {
  categoryShortLabel,
  GENDER_LABEL,
  LOCALITY_LABEL,
  OnSiteRegistrationInput,
  resolveCategory,
  type CheckInStatus,
  type Gender,
  type Locality,
} from '@triatlon/shared';
import {
  massStartEvents,
  nextFreeBib,
  startOverview,
  undoStartEvents,
  type CheckpointEntry,
  type LocalParticipant,
  type RaceSnapshot,
} from '../lib/view';
import { enqueue, getState, newEvent, serverNow, uuid } from '../store';
import {
  Button,
  C,
  Card,
  ConfirmButton,
  ErrorText,
  Field,
  formatClock,
  Muted,
  s,
  Segmented,
} from '../ui';

// ---------- hromadný start ----------

export function StartPanel({
  raceId,
  checkpointId,
  entries,
}: {
  raceId: string;
  checkpointId: string;
  entries: CheckpointEntry[];
}) {
  const groups = startOverview(entries);

  function massStart(waiting: CheckpointEntry[]) {
    const { deviceId } = getState();
    const ts = new Date(serverNow()).toISOString();
    const events = massStartEvents(waiting, checkpointId, ts, deviceId, uuid);
    enqueue(
      raceId,
      events.map((event) => ({ kind: 'event' as const, event })),
    );
  }

  function undo(group: ReturnType<typeof startOverview>[number]) {
    const { deviceId } = getState();
    const ts = new Date(serverNow()).toISOString();
    const events = undoStartEvents(group, checkpointId, ts, deviceId, uuid);
    enqueue(
      raceId,
      events.map((event) => ({ kind: 'event' as const, event })),
    );
  }

  return (
    <ScrollView contentContainerStyle={s.pad}>
      <Muted>
        Každá kategorie startuje hromadně a zvlášť. Start zapíše stejný čas všem přítomným v
        kategorii. Kdo vyrazí později, zapíšete mu start zvlášť.
      </Muted>
      {groups.length === 0 && <Muted>Žádní přítomní závodníci.</Muted>}
      {groups.map((g) => {
        const mine = g.entries.some((e) => e.time && e.mine);
        const pending = g.entries.some((e) => e.sync === 'pending');
        return (
          <Card key={g.category.id}>
            <View style={[s.row, { justifyContent: 'space-between' }]}>
              <Text style={s.h2}>{g.category.name}</Text>
              <Text style={s.muted}>{categoryShortLabel(g.category)}</Text>
            </View>
            <Muted>
              Přítomno {g.entries.length}
              {g.startedAt
                ? ` · odstartováno ${formatClock(g.startedAt, true)}${pending ? ' ⏳' : ' ✓'}`
                : ' · čeká na start'}
            </Muted>
            {!g.startedAt ? (
              <ConfirmButton
                big
                title={`Start ${g.category.name}`}
                confirmTitle={`Opravdu odstartovat ${g.entries.length} závodníků?`}
                disabled={!g.waiting.length}
                onConfirm={() => massStart(g.waiting)}
              />
            ) : (
              <>
                {g.waiting.length > 0 && (
                  <>
                    <Text style={s.label}>Ještě nestartovali — pozdní start:</Text>
                    {g.waiting.map((e) => (
                      <View
                        key={e.participant.id}
                        style={[s.row, { justifyContent: 'space-between' }]}
                      >
                        <Text style={s.text}>
                          {e.participant.bib} · {e.participant.lastName} {e.participant.firstName}
                          {e.participant.nickname ? ` „${e.participant.nickname}“` : ''}
                        </Text>
                        <ConfirmButton
                          title="Start"
                          confirmTitle="Opravdu?"
                          onConfirm={() =>
                            enqueue(raceId, [
                              {
                                kind: 'event',
                                event: newEvent('record', e.participant.id, checkpointId),
                              },
                            ])
                          }
                        />
                      </View>
                    ))}
                  </>
                )}
                {mine && (
                  <ConfirmButton
                    kind="secondary"
                    title="Vrátit start"
                    confirmTitle="Opravdu zrušit start kategorie?"
                    onConfirm={() => undo(g)}
                  />
                )}
              </>
            )}
          </Card>
        );
      })}
    </ScrollView>
  );
}

// ---------- check-in ----------

const STATUS_OPTIONS: { value: CheckInStatus; label: string }[] = [
  { value: 'checked_in', label: 'Přítomen' },
  { value: 'absent', label: 'Nepřítomen' },
];

export function CheckInPanel({
  raceId,
  snapshot,
  participants,
  checkpointId,
}: {
  raceId: string;
  snapshot: RaceSnapshot;
  participants: LocalParticipant[];
  checkpointId: string;
}) {
  const [query, setQuery] = useState('');
  const categories = snapshot.race.categories.filter((c) => c.checkpointIds.includes(checkpointId));
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const order = new Map(categories.map((c, i) => [c.id, i]));
  const list = participants
    .filter((p) => categoryById.has(p.categoryId) && p.status !== 'disqualified')
    .filter((p) => {
      if (!query) return true;
      const q = query.toLocaleLowerCase('cs');
      return (
        String(p.bib).startsWith(q) ||
        `${p.lastName} ${p.firstName} ${p.nickname ?? ''}`.toLocaleLowerCase('cs').includes(q)
      );
    })
    .sort(
      (a, b) => (order.get(a.categoryId) ?? 0) - (order.get(b.categoryId) ?? 0) || a.bib - b.bib,
    );
  const counts = {
    present: participants.filter((p) => categoryById.has(p.categoryId) && p.status === 'checked_in')
      .length,
    absent: participants.filter((p) => categoryById.has(p.categoryId) && p.status === 'absent')
      .length,
    unknown: participants.filter((p) => categoryById.has(p.categoryId) && p.status === 'registered')
      .length,
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 12, gap: 6 }}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Hledat číslo nebo jméno"
          style={[s.input, { paddingVertical: 8 }]}
        />
        <Muted>
          Přítomno {counts.present} · nepřítomno {counts.absent} · neověřeno {counts.unknown}
        </Muted>
      </View>
      <FlatList
        data={list}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 32, gap: 6 }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item: p }) => {
          const category = categoryById.get(p.categoryId)!;
          return (
            <View
              style={[s.card, { padding: 10, gap: 6 }, p.status === 'absent' && { opacity: 0.6 }]}
            >
              <View style={[s.row, { justifyContent: 'space-between' }]}>
                <Text style={[s.text, { fontWeight: '700' }]}>
                  {p.unconfirmed ? `${p.bib}*` : p.bib} · {p.lastName} {p.firstName}
                  {p.nickname ? ` „${p.nickname}“` : ''}
                </Text>
                <Text style={s.muted}>
                  {categoryShortLabel(category)}
                  {p.statusPending ? ' ⏳' : ''}
                </Text>
              </View>
              <Segmented
                value={p.status === 'registered' ? null : (p.status as CheckInStatus)}
                options={STATUS_OPTIONS}
                onChange={(status) => {
                  if (status !== p.status) {
                    enqueue(raceId, [{ kind: 'status', participantId: p.id, status }]);
                  }
                }}
              />
            </View>
          );
        }}
      />
    </View>
  );
}

// ---------- registrace na místě ----------

export function RegisterPanel({
  raceId,
  snapshot,
  participants,
}: {
  raceId: string;
  snapshot: RaceSnapshot;
  participants: LocalParticipant[];
}) {
  const race = snapshot.race;
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [nickname, setNickname] = useState('');
  const [formal, setFormal] = useState(true);
  const [birthYear, setBirthYear] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [locality, setLocality] = useState<Locality>('local');
  const [bib, setBib] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const year = Number(birthYear);
  const resolved = useMemo(() => {
    if (!gender || birthYear.length !== 4) return null;
    return resolveCategory(
      { birthYear: year, gender, locality },
      race.year,
      race.ageGroups,
      race.categories,
    );
  }, [gender, birthYear, year, locality, race]);
  const category = resolved && 'category' in resolved ? resolved.category : null;
  const suggested = category ? nextFreeBib(participants, category.id) : null;

  function submit() {
    setError(null);
    const parsed = OnSiteRegistrationInput.safeParse({
      id: uuid(),
      firstName,
      lastName,
      nickname,
      formal,
      birthYear: year,
      gender,
      locality,
      bib: bib ? Number(bib) : (suggested ?? undefined),
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join(' '));
      return;
    }
    if (!category) {
      setError(resolved && 'error' in resolved ? resolved.error : 'Vyplňte ročník a pohlaví.');
      return;
    }
    const taken = participants.some(
      (p) => p.categoryId === category.id && p.bib === parsed.data.bib,
    );
    if (taken) {
      setError(`Číslo ${parsed.data.bib} už je v kategorii ${category.name} obsazené.`);
      return;
    }
    enqueue(raceId, [{ kind: 'register', registration: parsed.data }]);
    setDone(
      `${parsed.data.lastName} ${parsed.data.firstName}: číslo ${parsed.data.bib}, ${category.name}. ` +
        'Číslo potvrdí server — kdyby bylo mezitím obsazené, appka ohlásí nové.',
    );
    setFirstName('');
    setLastName('');
    setNickname('');
    setFormal(true);
    setBirthYear('');
    setGender(null);
    setBib('');
  }

  return (
    <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      {done && (
        <Card style={{ backgroundColor: C.okBg, borderColor: C.ok }}>
          <Text style={s.text}>✓ Zaregistrováno a označeno jako přítomen. {done}</Text>
        </Card>
      )}
      <Card>
        <Text style={s.h2}>Registrace na místě</Text>
        <Field label="Jméno" value={firstName} onChangeText={setFirstName} autoCapitalize="words" />
        <Field
          label="Příjmení"
          value={lastName}
          onChangeText={setLastName}
          autoCapitalize="words"
        />
        <Field
          label="Přezdívka (nepovinná)"
          value={nickname}
          onChangeText={setNickname}
          autoCapitalize="words"
          maxLength={40}
        />
        <Text style={s.label}>Oslovení ve výsledcích</Text>
        <Segmented
          value={formal ? 'formal' : 'informal'}
          options={[
            { value: 'formal', label: 'formálně' },
            { value: 'informal', label: 'neformálně' },
          ]}
          onChange={(v) => setFormal(v === 'formal')}
        />
        <Field
          label="Ročník narození"
          value={birthYear}
          onChangeText={(v) => setBirthYear(v.replace(/\D/g, '').slice(0, 4))}
          keyboardType="number-pad"
          inputMode="numeric"
          placeholder="např. 1990"
        />
        <Text style={s.label}>Pohlaví</Text>
        <Segmented
          value={gender}
          options={[
            { value: 'male', label: GENDER_LABEL.male },
            { value: 'female', label: GENDER_LABEL.female },
          ]}
          onChange={setGender}
        />
        <Text style={s.label}>Lokalita</Text>
        <Segmented
          value={locality}
          options={[
            { value: 'local', label: LOCALITY_LABEL.local },
            { value: 'guest', label: LOCALITY_LABEL.guest },
          ]}
          onChange={setLocality}
        />
        {resolved && 'error' in resolved && <ErrorText>{resolved.error}</ErrorText>}
        {category && <Muted>Kategorie: {category.name}</Muted>}
        <Field
          label={`Startovní číslo${suggested ? ` (volné: ${suggested})` : ''}`}
          value={bib}
          onChangeText={(v) => setBib(v.replace(/\D/g, '').slice(0, 5))}
          keyboardType="number-pad"
          inputMode="numeric"
          placeholder={suggested ? String(suggested) : ''}
        />
        <ErrorText>{error}</ErrorText>
        <Button big title="Zaregistrovat" onPress={submit} />
      </Card>
    </ScrollView>
  );
}
