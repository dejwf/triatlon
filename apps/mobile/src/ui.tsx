/** Sdílené UI prvky appky: barvy, tlačítka, potvrzení dvojím klepnutím, stav synchronizace. */
import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { router } from 'expo-router';
import { useApp } from './store';

export const C = {
  bg: '#f4f6f8',
  card: '#ffffff',
  text: '#16202a',
  muted: '#5f6b76',
  border: '#d5dbe1',
  primary: '#0b6bcb',
  primaryText: '#ffffff',
  ok: '#1a7f37',
  okBg: '#e3f4e8',
  warn: '#9a6700',
  warnBg: '#fff4d6',
  danger: '#c62828',
  dangerBg: '#fde8e8',
  done: '#e6e9ec',
  doneText: '#8a95a0',
  info: '#08478a',
  infoBg: '#eef5fd',
  line: '#eef0f2',
};

/** Disciplíny (design_claude.md 2): plavání, kolo, běh — stejné jako na webu. */
export const LEG_COLORS = ['#0b6bcb', '#ef6c00', '#6a1b9a'];
export const legColor = (i: number) => LEG_COLORS[i % LEG_COLORS.length]!;

/** Barvy kategorií — rychlé rozlišení stejných čísel v různých kategoriích. */
const CATEGORY_COLORS = [
  '#0b6bcb',
  '#c2185b',
  '#2e7d32',
  '#ef6c00',
  '#6a1b9a',
  '#00838f',
  '#5d4037',
  '#455a64',
];
export const categoryColor = (index: number) => CATEGORY_COLORS[index % CATEGORY_COLORS.length]!;

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled,
  style,
  big,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  big?: boolean;
}) {
  const bg = kind === 'primary' ? C.primary : kind === 'danger' ? C.danger : C.card;
  const fg = kind === 'secondary' ? C.text : C.primaryText;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        big && s.buttonBig,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
        kind === 'secondary' && { borderWidth: 1, borderColor: C.border },
        style,
      ]}
    >
      <Text style={[s.buttonText, big && s.buttonTextBig, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

/** Nevratně vypadající akce: první klepnutí se zeptá, druhé (do 4 s) provede. */
export function ConfirmButton({
  title,
  confirmTitle,
  onConfirm,
  ...rest
}: {
  title: string;
  confirmTitle: string;
  onConfirm: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  big?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button
      {...rest}
      kind={armed ? 'danger' : rest.kind}
      title={armed ? confirmTitle : title}
      onPress={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    />
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor={C.muted} style={[s.input, style]} {...rest} />
    </View>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <View style={s.segmented}>
      {options.map((o) => (
        <Pressable
          key={o.value}
          onPress={() => onChange(o.value)}
          style={[s.segment, value === o.value && s.segmentActive]}
        >
          <Text style={[s.segmentText, value === o.value && s.segmentTextActive]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={s.muted}>{children}</Text>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <Text style={s.error}>{children}</Text>;
}

export function Loading() {
  return <ActivityIndicator style={{ margin: 24 }} color={C.primary} />;
}

/** Odznak v hlavičce: „Online · 0“ / „Offline · 14“ (počet akcí ve frontě). Klepnutím detail. */
export function SyncBadge() {
  const outbox = useApp((st) => st.outbox);
  const net = useApp((st) => st.net);
  const userId = useApp((st) => st.session?.user.id);
  const pending = outbox.filter((i) => i.state === 'pending' && i.userId === userId).length;
  const problems = outbox.filter((i) => i.state === 'rejected' || i.warning).length;
  const offline = net.online === false;

  let label = `${offline ? 'Offline' : 'Online'} · ${pending}`;
  let color = offline ? C.warn : pending ? C.warn : C.ok;
  let bg = offline ? C.warnBg : pending ? C.warnBg : C.okBg;
  if (problems) {
    label = `⚠ ${problems} · ${pending}`;
    color = C.danger;
    bg = C.dangerBg;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Stav synchronizace: ${offline ? 'offline' : 'online'}, ${pending} ve frontě`}
      onPress={() => router.push('/sync')}
      style={[s.badge, s.row, { backgroundColor: bg, gap: 6 }]}
      hitSlop={8}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ color, fontWeight: '700', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

/** Hlavička obrazovky na dva řádky (název + podtitul), např. checkpoint a závod. */
export function HeaderTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View>
      <Text style={{ fontSize: 17, fontWeight: '700', color: C.text }} numberOfLines={1}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={{ fontSize: 12, color: C.muted }} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

export function LocBadge({ local }: { local: boolean }) {
  return (
    <Text
      accessibilityLabel={local ? 'domácí' : 'host'}
      style={{
        fontSize: 11,
        fontWeight: '700',
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 5,
        overflow: 'hidden',
        backgroundColor: local ? C.infoBg : C.warnBg,
        color: local ? C.info : '#7a5200',
      }}
    >
      {local ? 'D' : 'H'}
    </Text>
  );
}

/**
 * Mini pruh rozložení času (plavání → kolo → běh) ve společném měřítku kategorie.
 * Na trati je zbytek šrafovaný (odhad), u DNF jen hotové úseky.
 */
export function MiniBar({
  legs,
  scale,
  rest,
}: {
  legs: (number | null)[];
  scale: number;
  rest: number | null;
}) {
  const w = (ms: number) => `${Math.min(100, (ms / scale) * 100)}%` as const;
  return (
    <View
      style={{
        flexDirection: 'row',
        height: 6,
        borderRadius: 3,
        overflow: 'hidden',
        backgroundColor: C.line,
      }}
    >
      {legs.map((ms, i) =>
        ms == null ? null : <View key={i} style={{ width: w(ms), backgroundColor: legColor(i) }} />,
      )}
      {rest != null && rest > 0 && (
        <View
          style={{
            width: w(rest),
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: C.muted,
            borderLeftWidth: 0,
            borderTopRightRadius: 3,
            borderBottomRightRadius: 3,
          }}
        />
      )}
    </View>
  );
}

export function formatClock(iso: string | null | undefined, tenths = false): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  const base = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return tenths ? `${base}.${Math.floor(d.getMilliseconds() / 100)}` : base;
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  pad: { padding: 16, gap: 12 },
  card: {
    backgroundColor: C.card,
    borderRadius: 10,
    padding: 14,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  h1: { fontSize: 22, fontWeight: '700', color: C.text },
  h2: { fontSize: 17, fontWeight: '700', color: C.text },
  text: { fontSize: 15, color: C.text },
  muted: { fontSize: 13, color: C.muted },
  error: { color: C.danger, fontSize: 14 },
  label: { fontSize: 13, color: C.muted, fontWeight: '600' },
  input: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 17,
    color: C.text,
  },
  button: {
    borderRadius: 8,
    paddingVertical: 11,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonBig: { paddingVertical: 16 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  buttonTextBig: { fontSize: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  segmented: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    overflow: 'hidden',
  },
  segment: { flex: 1, paddingVertical: 9, alignItems: 'center', backgroundColor: C.card },
  segmentActive: { backgroundColor: C.primary },
  segmentText: { fontSize: 14, fontWeight: '600', color: C.text },
  segmentTextActive: { color: C.primaryText },
  badge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
});
