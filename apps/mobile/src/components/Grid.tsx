/**
 * Grid čísel na checkpointu (CLAUDE.md, sekce 5 body 2–4): klepnutí na číslo zaznamená čas,
 * zaznamenané číslo je neaktivní; šipka ▾ otevře menu „přidat poznámku“ / „vrátit akci“.
 */
import { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { categoryShortLabel, type CategoryDto } from '@triatlon/shared';
import type { CheckpointEntry } from '../lib/view';
import { enqueue, newEvent } from '../store';
import { Button, C, categoryColor, formatClock, Muted, s } from '../ui';

export function Grid({
  raceId,
  checkpointId,
  entries,
  categories,
  hidden,
}: {
  raceId: string;
  checkpointId: string;
  entries: CheckpointEntry[];
  categories: CategoryDto[];
  hidden: number;
}) {
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [onlyWaiting, setOnlyWaiting] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);

  const colorOf = useMemo(
    () => new Map(categories.map((c, i) => [c.id, categoryColor(i)])),
    [categories],
  );
  const visible = entries.filter(
    (e) =>
      (!category || e.category.id === category) &&
      (!query || String(e.participant.bib).startsWith(query)) &&
      (!onlyWaiting || !e.time),
  );
  const done = entries.filter((e) => e.time).length;
  const columns = Math.max(3, Math.floor(width / 96));
  const menuEntry = entries.find((e) => e.participant.id === menu);

  function record(e: CheckpointEntry) {
    enqueue(raceId, [{ kind: 'event', event: newEvent('record', e.participant.id, checkpointId) }]);
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 12, gap: 8 }}>
        <View style={s.row}>
          <TextInput
            value={query}
            onChangeText={(v) => setQuery(v.replace(/\D/g, ''))}
            placeholder="Hledat číslo"
            keyboardType="number-pad"
            inputMode="numeric"
            style={[s.input, { flex: 1, paddingVertical: 8 }]}
          />
          <Pressable
            onPress={() => setOnlyWaiting(!onlyWaiting)}
            style={[chip, onlyWaiting && chipActive]}
          >
            <Text style={[chipText, onlyWaiting && { color: C.primaryText }]}>Jen čekající</Text>
          </Pressable>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 6 }}
        >
          <Pressable onPress={() => setCategory(null)} style={[chip, !category && chipActive]}>
            <Text style={[chipText, !category && { color: C.primaryText }]}>Vše</Text>
          </Pressable>
          {categories
            .filter((c) => entries.some((e) => e.category.id === c.id))
            .map((c) => (
              <Pressable
                key={c.id}
                onPress={() => setCategory(c.id === category ? null : c.id)}
                style={[
                  chip,
                  { borderColor: colorOf.get(c.id) },
                  c.id === category && { backgroundColor: colorOf.get(c.id) },
                ]}
              >
                <Text style={[chipText, c.id === category && { color: C.primaryText }]}>
                  {categoryShortLabel(c)}
                </Text>
              </Pressable>
            ))}
        </ScrollView>
        <Muted>
          Zaznamenáno {done} z {entries.length}
          {hidden ? ` · ${hidden} nepřítomných skryto` : ''}
        </Muted>
      </View>
      <FlatList
        key={columns}
        data={visible}
        numColumns={columns}
        keyExtractor={(e) => e.participant.id}
        contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <Tile
            entry={item}
            color={colorOf.get(item.category.id) ?? C.primary}
            onRecord={() => record(item)}
            onMenu={() => setMenu(item.participant.id)}
          />
        )}
        ListEmptyComponent={<Muted>Žádní závodníci k zobrazení.</Muted>}
      />
      {menuEntry && (
        <EntryMenu
          raceId={raceId}
          checkpointId={checkpointId}
          entry={menuEntry}
          onClose={() => setMenu(null)}
        />
      )}
    </View>
  );
}

function Tile({
  entry,
  color,
  onRecord,
  onMenu,
}: {
  entry: CheckpointEntry;
  color: string;
  onRecord: () => void;
  onMenu: () => void;
}) {
  const { participant: p, time } = entry;
  const recorded = !!time;
  return (
    <View
      style={[
        tile,
        { borderColor: entry.rejected ? C.danger : color },
        recorded && { backgroundColor: C.done, borderColor: C.border },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Číslo ${p.bib}, ${categoryShortLabel(entry.category)}`}
        accessibilityState={{ disabled: recorded }}
        disabled={recorded}
        onPress={onRecord}
        style={({ pressed }) => [
          { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
          pressed && { opacity: 0.5 },
        ]}
      >
        <Text style={{ fontSize: 26, fontWeight: '800', color: recorded ? C.muted : C.text }}>
          {p.unconfirmed ? `${p.bib}*` : p.bib}
        </Text>
        <Text style={{ fontSize: 11, fontWeight: '700', color: recorded ? C.muted : color }}>
          {categoryShortLabel(entry.category)}
        </Text>
        {recorded && (
          <Text style={{ fontSize: 11, color: C.muted }}>
            {entry.sync === 'pending' ? '⏳ ' : '✓ '}
            {formatClock(time.ts)}
            {time.conflict ? ' ⚠' : ''}
          </Text>
        )}
        {entry.rejected && <Text style={{ fontSize: 11, color: C.danger }}>⚠ odmítnuto</Text>}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Menu čísla ${p.bib}`}
        onPress={onMenu}
        hitSlop={6}
        style={{
          alignItems: 'center',
          paddingVertical: 4,
          borderTopWidth: 1,
          borderTopColor: C.border,
        }}
      >
        <Text style={{ fontSize: 13, color: C.muted }}>
          {entry.notes.length ? `💬${entry.notes.length} ` : ''}▾
        </Text>
      </Pressable>
    </View>
  );
}

function EntryMenu({
  raceId,
  checkpointId,
  entry,
  onClose,
}: {
  raceId: string;
  checkpointId: string;
  entry: CheckpointEntry;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const p = entry.participant;

  function addNote() {
    if (!note.trim()) return;
    enqueue(raceId, [
      { kind: 'event', event: newEvent('note', p.id, checkpointId, { note: note.trim() }) },
    ]);
    setNote('');
  }

  function undo() {
    enqueue(raceId, [
      {
        kind: 'event',
        event: newEvent('cancel', p.id, checkpointId, { refEventId: entry.time!.recordId }),
      },
    ]);
    onClose();
  }

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: '#0006', justifyContent: 'flex-end' }}
        onPress={onClose}
      >
        <Pressable
          style={[s.card, { borderRadius: 16, margin: 8, paddingBottom: 24 }]}
          onPress={() => undefined}
        >
          <Text style={s.h2}>
            {p.bib} · {p.lastName} {p.firstName}
          </Text>
          <Muted>
            {entry.category.name}
            {p.unconfirmed ? ' · registrace čeká na potvrzení serverem' : ''}
          </Muted>
          {entry.time ? (
            <Text style={s.text}>
              Zaznamenáno {formatClock(entry.time.ts, true)}
              {entry.sync === 'pending' ? ' (čeká na odeslání)' : ''}
              {entry.mine ? '' : ' — jiným organizátorem'}
              {entry.time.conflict ? '\n⚠ Víc záznamů — admin ověří.' : ''}
            </Text>
          ) : (
            <Muted>Čas zatím nezaznamenán.</Muted>
          )}
          {entry.rejected && <Text style={s.error}>Odmítnuto serverem: {entry.rejected}</Text>}
          {entry.notes.map((n) => (
            <Text key={n.eventId} style={s.text}>
              💬 {n.text}
            </Text>
          ))}
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Přidat poznámku…"
            style={s.input}
            multiline
          />
          <Button
            title="Přidat poznámku"
            kind="secondary"
            disabled={!note.trim()}
            onPress={addNote}
          />
          {entry.time && entry.mine && <Button title="Vrátit akci" kind="danger" onPress={undo} />}
          {entry.time && !entry.mine && (
            <Muted>Záznam jiného organizátora může zrušit jen admin.</Muted>
          )}
          <Button title="Zavřít" kind="secondary" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const tile = {
  flex: 1,
  margin: 4,
  minHeight: 92,
  maxWidth: 140,
  borderRadius: 10,
  borderWidth: 2,
  backgroundColor: C.card,
  overflow: 'hidden' as const,
};
const chip = {
  borderWidth: 1.5,
  borderColor: C.border,
  borderRadius: 16,
  paddingHorizontal: 12,
  paddingVertical: 6,
  backgroundColor: C.card,
};
const chipActive = { backgroundColor: C.primary, borderColor: C.primary };
const chipText = { fontSize: 13, fontWeight: '600' as const, color: C.text };
