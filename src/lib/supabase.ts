import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

/**
 * A trailing slash or a pasted path here produces a double slash in every
 * request, and Supabase's gateway answers "Invalid path specified in request
 * url" -- which says nothing about the cause. Normalise what we can, and fail
 * loudly and specifically on what we cannot.
 */
const rawUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim().replace(/^["']|["']$/g, '');
const url = rawUrl?.replace(/\/+$/, '');
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim().replace(/^["']|["']$/g, '');

if (!url || !anonKey) {
  throw new Error(
    'Supabase is not configured. Copy .env.example to .env and fill in ' +
      'EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY, then restart ' +
      'the dev server with `npx expo start --clear`.'
  );
}

if (!/^https:\/\/[^/\s]+$/.test(url)) {
  throw new Error(
    `EXPO_PUBLIC_SUPABASE_URL is "${url}", which has a path on the end. It should be ` +
      'just the host, like https://abcdefghijk.supabase.co — no trailing slash, no /rest/v1, ' +
      'and not the dashboard address. Fix .env and restart with `npx expo start --clear`.'
  );
}

// The dashboard address is the other easy thing to paste by mistake, and it
// fails much later with a confusing error.
if (/supabase\.com/.test(url)) {
  throw new Error(
    `EXPO_PUBLIC_SUPABASE_URL is "${url}", which is the dashboard address. You want the ` +
      'Project URL from Project Settings → API, which ends in .supabase.co.'
  );
}

if (anonKey.startsWith('sb_secret') || anonKey.includes('service_role')) {
  throw new Error(
    'EXPO_PUBLIC_SUPABASE_ANON_KEY looks like a secret or service_role key. That key bypasses ' +
      'every access rule and must never ship in an app. Use the anon / public key instead.'
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Native apps never receive the session in a URL fragment; leaving this on
    // makes the client hang waiting for one.
    detectSessionInUrl: Platform.OS === 'web',
  },
});

/** Postgres errors arrive with codes; surface the message the function raised
 *  rather than a generic failure, since these are written to be read. */
export function errorMessage(error: unknown): string {
  if (!error) return 'Something went wrong.';
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
