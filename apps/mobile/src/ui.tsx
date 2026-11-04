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
};

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

/** Odznak v hlavičce: stav spojení a fronty. Klepnutím detail synchronizace. */
export function SyncBadge() {
  const outbox = useApp((st) => st.outbox);
  const net = useApp((st) => st.net);
  const userId = useApp((st) => st.session?.user.id);
  const pending = outbox.filter((i) => i.state === 'pending' && i.userId === userId).length;
  const problems = outbox.filter((i) => i.state === 'rejected' || i.warning).length;

  let label = net.online === false ? '○ offline' : '● online';
  let color = net.online === false ? C.muted : C.ok;
  let bg = net.online === false ? C.done : C.okBg;
  if (pending) {
    label = `⏳ ${pending} čeká`;
    color = C.warn;
    bg = C.warnBg;
  }
  if (problems) {
    label = `⚠ ${problems}${pending ? ` · ⏳ ${pending}` : ''}`;
    color = C.danger;
    bg = C.dangerBg;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Stav synchronizace"
      onPress={() => router.push('/sync')}
      style={[s.badge, { backgroundColor: bg }]}
    >
      <Text style={{ color, fontWeight: '600', fontSize: 13 }}>{label}</Text>
    </Pressable>
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
