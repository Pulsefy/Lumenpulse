import { Platform } from 'react-native';
import * as NativeSecureStore from 'expo-secure-store';

/**
 * expo-secure-store has no web implementation in the installed version --
 * every call throws `TypeError: ... is not a function` on web, which broke
 * auth entirely there (checkAuthStatus/login/etc. all read/write through
 * SecureStore). This wrapper keeps the exact same three-method API and
 * delegates to the real SecureStore on native, falling back to
 * localStorage on web (not a secure store, but strictly better than a
 * hard crash, and web was already unauthenticated-only before this).
 */
export async function getItemAsync(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  return NativeSecureStore.getItemAsync(key);
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // localStorage unavailable (private mode, disabled storage) -- swallow,
      // matching the "best-effort" tolerance the native path already has.
    }
    return;
  }
  return NativeSecureStore.setItemAsync(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore, see setItemAsync
    }
    return;
  }
  return NativeSecureStore.deleteItemAsync(key);
}
