/**
 * Meal reminders.
 *
 * Scheduled on the device, not from a server: they must fire without a
 * network, and the phone is the only thing that knows the user is standing in
 * a kitchen.
 *
 * expo-notifications throws on import inside Expo Go (SDK 53 removed Android
 * push support from it), and a module that throws while loading takes every
 * screen that imports it down with it. So it is loaded lazily and guarded:
 * without it, reminders quietly do not schedule and everything else works.
 * A development build gets the real thing.
 */

import { Platform } from 'react-native';

import type { ScheduledMeal } from './types';

type NotificationsModule = typeof import('expo-notifications');

/** undefined = not tried yet, null = unavailable here. */
let cached: NotificationsModule | null | undefined;

function load(): NotificationsModule | null {
  if (cached !== undefined) return cached;
  if (Platform.OS === 'web') {
    cached = null;
    return cached;
  }
  try {
    // Required rather than imported so the throw is catchable: a static import
    // fails at module evaluation, before any of this can run.
    const mod = require('expo-notifications') as NotificationsModule;
    mod.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    cached = mod;
  } catch {
    // Expo Go, or a build without the module. Not an error worth surfacing:
    // reminders are a convenience, not part of the ledger.
    cached = null;
  }
  return cached;
}

/** True when this build can actually schedule reminders. */
export function remindersAvailable(): boolean {
  return load() !== null;
}

export async function ensurePermission(): Promise<boolean> {
  const Notifications = load();
  if (!Notifications) return false;

  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  if (!existing.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

/**
 * Replaces every pending reminder with the ones this plan needs. Replacing
 * wholesale is deliberate: regenerating a plan otherwise leaves reminders for
 * meals that no longer exist.
 *
 * Returns how many were set -- zero when reminders are unavailable, which the
 * caller reports rather than pretending.
 */
export async function scheduleReminders(meals: ScheduledMeal[]): Promise<number> {
  const Notifications = load();
  if (!Notifications) return 0;
  if (!(await ensurePermission())) return 0;

  await Notifications.cancelAllScheduledNotificationsAsync();

  let scheduled = 0;
  for (const meal of meals) {
    const fireAt = meal.notify_at ? new Date(meal.notify_at) : null;
    if (!fireAt || fireAt.getTime() <= Date.now()) continue;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${meal.recipe.name} in 30 minutes`,
        body: meal.recipe.est_minutes
          ? `${meal.category} · about ${meal.recipe.est_minutes} minutes to cook`
          : String(meal.category),
        data: { slotId: meal.id },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt },
    });
    scheduled += 1;
  }
  return scheduled;
}

export async function clearReminders(): Promise<void> {
  const Notifications = load();
  if (!Notifications) return;
  await Notifications.cancelAllScheduledNotificationsAsync();
}
