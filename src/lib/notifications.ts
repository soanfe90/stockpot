/**
 * Meal reminders.
 *
 * Scheduled on the device, not from a server: they must fire without a
 * network, and the phone is the only thing that knows the user is standing in
 * a kitchen.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { ScheduledMeal } from './types';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function ensurePermission(): Promise<boolean> {
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
 */
export async function scheduleReminders(meals: ScheduledMeal[]): Promise<number> {
  if (Platform.OS === 'web') return 0;
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
  if (Platform.OS === 'web') return;
  await Notifications.cancelAllScheduledNotificationsAsync();
}
