/**
 * Trvalé úložiště v telefonu (SQLite). Synchronní zápis: akce je uložená dřív, než ji UI
 * potvrdí — pád appky ani vybitá baterie ji neztratí.
 */
import Storage from 'expo-sqlite/kv-store';

export function load<T>(key: string): T | null {
  const raw = Storage.getItemSync(key);
  return raw ? (JSON.parse(raw) as T) : null;
}

export function save(key: string, value: unknown): void {
  if (value === null || value === undefined) Storage.removeItemSync(key);
  else Storage.setItemSync(key, JSON.stringify(value));
}
