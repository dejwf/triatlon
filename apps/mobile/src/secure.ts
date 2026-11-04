/** Přihlašovací tokeny v zabezpečeném úložišti systému (Keychain / Keystore). */
import * as SecureStore from 'expo-secure-store';

export const secure = {
  get: (key: string) => SecureStore.getItemAsync(key),
  set: (key: string, value: string | null) =>
    value === null ? SecureStore.deleteItemAsync(key) : SecureStore.setItemAsync(key, value),
};
