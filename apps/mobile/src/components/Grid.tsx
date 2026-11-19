/**
 * Grid čísel na checkpointu (CLAUDE.md, sekce 5 body 2–4): klepnutí na číslo zaznamená čas,
 * zaznamenané číslo je neaktivní; šipka ▾ otevře menu „přidat poznámku“ / „vrátit akci“.
 */
import { useEffect, useMemo, useState } from 'react';
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
  notStarted,
  closed,
}: {
  raceId: string;
  checkpointId: string;
  entries: CheckpointEntry[];
  categories: CategoryDto[];
  hidden: number;
  notStarted: number;
  closed: number;
}) {
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [onlyWaiting, setOnlyWaiting] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [last, setLast] = useState<LastRecord | null>(null);

  // Snackbar s „Vrátit“ zmizí po chvíli sám.
  useEffect(() => {
    if (!last) return;
    const t = setTimeout(() => setLast(null), SNACKBAR_MS);
    return () => clearTimeout(t);
  }, [last]);

  const colorOf = useMemo(
    () => new Map(categories.map((c, i) => [c.id, categoryColor(i)])),
    [categories],
  );
  const shown = categories.filter((c) => entries.some((e) => e.category.id === c.id));
  const visible = entries.filter(
    (e) =>
      (!category || e.category.id === category) &&
      (!query || String(e.participant.bib).startsWith(query)) &&
      (!onlyWaiting || !e.time),
  );
  const done = entries.filter((e) => e.time).length;
  const columns = Math.max(4, Math.floor(width / 88));
  const menuEntry = entries.find((e) => e.participant.id === menu);
  // Snackbar platí, jen dokud je záznam platný (mohl být mezitím vrácen v menu).
  const lastEntry =
    last &&
    entries.find(
      (e) => e.participant.id === last.participantId && e.time?.recordId === last.recordId,
    );

  function record(e: CheckpointEntry) {
    const event = newEvent('record', e.participant.id, checkpointId);
    enqueue(raceId, [{ kind: 'event', event }]);
    setLast({
      participantId: e.participant.id,
      recordId: event.id,
      bib: e.participant.bib,
      category: categoryShortLabel(e.category),
      color: colorOf.get(e.category.id) ?? C.primary,
      ts: event.ts,
    });
  }

  function undoLast() {
    if (!last) return;
    enqueue(raceId, [
      {
        kind: 'event',
        event: newEvent('cancel', last.participantId, checkpointId, { refEventId: last.recordId }),
      },
    ]);
    setLast(null);
  }

  const notes = [
    notStarted ? `${notStarted} nevystartovalo` : '',
    hidden ? `${hidden} nepřítomní skryti` : '',
    closed ? `${closed} v uzavřených kat.` : '',
  ].filter(Boolean);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8, gap: 10 }}>
        <View style={s.row}>
          <TextInput
            value={query}
            onChangeText={(v) => setQuery(v.replace(/\D/g, ''))}
            placeholder="Hledat číslo"
            placeholderTextColor={C.muted}
            keyboardType="number-pad"
            inputMode="numeric"
            accessibilityLabel="Hledat číslo"
            style={[s.input, { flex: 1, paddingVertical: 9 }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: onlyWaiting }}
            onPress={() => setOnlyWaiting(!onlyWaiting)}
            style={[chip, { paddingVertical: 10 }, onlyWaiting && chipActive]}
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
          {shown.map((c) => (
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
        <View style={{ gap: 6 }}>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <Text style={s.text}>
              Zaznamenáno{' '}
              <Text style={{ fontWeight: '700' }}>
                {done} z {entries.length}
              </Text>
            </Text>
            {notes.length > 0 && <Muted>{notes.join(' · ')}</Muted>}
          </View>
          {/* Průběh rozdělený podle barev kategorií. */}
          <View
            style={{
              flexDirection: 'row',
              height: 6,
              borderRadius: 3,
              overflow: 'hidden',
              backgroundColor: C.line,
            }}
          >
            {shown.map((c) => {
              const n = entries.filter((e) => e.time && e.category.id === c.id).length;
              return n ? (
                <View
                  key={c.id}
                  style={{
                    width: `${(n / Math.max(1, entries.length)) * 100}%`,
                    backgroundColor: colorOf.get(c.id),
                  }}
                />
              ) : null;
            })}
          </View>
        </View>
      </View>
      <FlatList
        key={columns}
        data={visible}
        numColumns={columns}
        keyExtractor={(e) => e.participant.id}
        contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: lastEntry ? 96 : 32 }}
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
      {last && lastEntry && (
        <View style={snackbar} accessibilityLiveRegion="polite">
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: last.color }} />
          <Text style={{ flex: 1, color: '#fff', fontSize: 15 }} numberOfLines={1}>
            Č. <Text style={{ fontWeight: '800' }}>{last.bib}</Text> ({last.category}) ·{' '}
            {formatClock(last.ts)}
          </Text>
          <Pressable accessibilityRole="button" onPress={undoLast} hitSlop={10}>
            <Text style={{ color: '#9ccaf5', fontWeight: '800', fontSize: 15 }}>Vrátit</Text>
          </Pressable>
        </View>
      )}
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

const SNACKBAR_MS = 8000;

interface LastRecord {
  participantId: string;
  recordId: string;
  bib: number;
  category: string;
  color: string;
  ts: string;
}

/**
 * Dlaždice čísla: barevný proužek kategorie; zaznamenané je šedé, přeškrtnuté a s časem.
 * Šipka ▾ (nebo dlouhé podržení) otevře menu „přidat poznámku“ / „vrátit akci“.
 */
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
        { borderColor: entry.rejected ? C.danger : recorded ? C.border : color },
        recorded && { backgroundColor: C.done },
      ]}
    >
      <View style={[stripe, { backgroundColor: recorded ? '#b9c1c9' : color }]} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Číslo ${p.bib}, ${categoryShortLabel(entry.category)}${recorded ? `, zaznamenáno ${formatClock(time.ts)}` : ''}`}
        accessibilityState={{ disabled: recorded }}
        disabled={recorded}
        onPress={onRecord}
        onLongPress={onMenu}
        style={({ pressed }) => [
          { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
          pressed && { opacity: 0.5 },
        ]}
      >
        <Text
          style={{
            fontSize: 26,
            fontWeight: '800',
            color: recorded ? C.doneText : C.text,
            textDecorationLine: recorded ? 'line-through' : 'none',
            fontVariant: ['tabular-nums'],
          }}
        >
          {p.unconfirmed ? `${p.bib}*` : p.bib}
        </Text>
        <Text
          style={{
            fontSize: 11,
            fontWeight: '600',
            color: recorded ? C.muted : C.muted,
            fontVariant: ['tabular-nums'],
          }}
          numberOfLines={1}
        >
          {recorded
            ? `${entry.sync === 'pending' ? '⏳ ' : ''}${formatClock(time.ts)}${time.conflict ? ' ⚠' : ''}`
            : categoryShortLabel(entry.category)}
        </Text>
        {entry.rejected && <Text style={{ fontSize: 11, color: C.danger }}>⚠ odmítnuto</Text>}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Menu čísla ${p.bib}`}
        onPress={onMenu}
        hitSlop={8}
        style={menuButton}
      >
        <Text style={{ fontSize: 12, color: C.muted }}>
          {entry.notes.length ? `💬${entry.notes.length}` : '▾'}
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
            {p.nickname ? ` „${p.nickname}“` : ''}
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
  minHeight: 76,
  maxWidth: 120,
  borderRadius: 10,
  borderWidth: 1,
  backgroundColor: C.card,
  overflow: 'hidden' as const,
};
const stripe = { position: 'absolute' as const, left: 0, right: 0, top: 0, height: 5 };
const menuButton = {
  position: 'absolute' as const,
  top: 6,
  right: 4,
  paddingHorizontal: 4,
  paddingVertical: 2,
};
const snackbar = {
  position: 'absolute' as const,
  left: 12,
  right: 12,
  bottom: 16,
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: 10,
  backgroundColor: '#16202a',
  borderRadius: 12,
  paddingHorizontal: 16,
  paddingVertical: 14,
  shadowColor: '#000',
  shadowOpacity: 0.2,
  shadowRadius: 8,
  elevation: 6,
};
const chip = {
  borderWidth: 1.5,
  borderColor: C.border,
  borderRadius: 999,
  paddingHorizontal: 12,
  paddingVertical: 6,
  backgroundColor: C.card,
};
const chipActive = { backgroundColor: C.primary, borderColor: C.primary };
const chipText = { fontSize: 13, fontWeight: '600' as const, color: C.text };
