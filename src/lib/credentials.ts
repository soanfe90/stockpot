/**
 * Remembering a sign-in between sessions.
 *
 * Signing out is deliberate, so coming back should not mean typing an address
 * and a password from scratch. Two separate things are remembered, because
 * they carry very different risk:
 *
 *   - the email address, always, so the field is filled in on return;
 *   - the password, only if asked for, and only in the device keystore.
 *
 * The keystore part matters. expo-secure-store is backed by the iOS keychain
 * and Android's EncryptedSharedPreferences, both tied to the device lock. A
 * password in AsyncStorage would sit in plain text in the app's sandbox, which
 * is not a reasonable place to put one -- so if the keystore is unavailable,
 * the password is simply not kept rather than kept somewhere worse.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const EMAIL_KEY = 'stockpot.last-email';
const PASSWORD_KEY = 'stockpot.saved-password';

/** SecureStore has no web implementation, and a browser has no keystore to
 *  stand in for one. Nothing is saved there rather than faking it. */
const keystoreAvailable = Platform.OS !== 'web';

export type RememberedSignIn = {
  email: string | null;
  /** Null unless the password was saved on this device and is still readable. */
  password: string | null;
};

export async function loadRemembered(): Promise<RememberedSignIn> {
  const email = await AsyncStorage.getItem(EMAIL_KEY).catch(() => null);
  if (!keystoreAvailable) return { email, password: null };

  // A keystore read can fail for reasons that are not the app's business --
  // the device was reset, the entry was invalidated. A blank form is a fine
  // outcome; an error screen on launch is not.
  const password = await SecureStore.getItemAsync(PASSWORD_KEY).catch(() => null);
  return { email, password };
}

/**
 * Called on a successful sign-in. The email is always kept; the password only
 * when asked for, and clearing it is what unticking the box does.
 */
export async function remember(email: string, password: string | null): Promise<void> {
  await AsyncStorage.setItem(EMAIL_KEY, email).catch(() => undefined);
  if (!keystoreAvailable) return;

  if (password) {
    await SecureStore.setItemAsync(PASSWORD_KEY, password, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }).catch(() => undefined);
  } else {
    await SecureStore.deleteItemAsync(PASSWORD_KEY).catch(() => undefined);
  }
}

/**
 * Forgets a saved password -- what unticking the box does.
 *
 * Deliberately *not* called on sign-out: surviving a sign-out is the entire
 * point of saving it. The protection against a shared phone is that saving is
 * opt-in and reversible here, not that it quietly expires.
 */
export async function forgetPassword(): Promise<void> {
  if (!keystoreAvailable) return;
  await SecureStore.deleteItemAsync(PASSWORD_KEY).catch(() => undefined);
}
