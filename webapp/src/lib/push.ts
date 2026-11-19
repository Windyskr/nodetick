import { api } from './api';
import { tOf, useI18n, type Lang } from '../i18n';

/** Browser Web Push support (service worker + Push API + Notification API). */
export function pushSupported(): boolean {
  return typeof Notification !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
}

/** This browser's push subscription, if it has one. */
export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration('/');
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/**
 * Register (or refresh) this device's subscription on the server. The UI
 * language travels with it so reminders arrive in the language of the device.
 */
export async function registerPushSubscription(subscription: PushSubscription, lang: Lang): Promise<void> {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error(tOf('notifyInvalidSubscription'));
  await api.subscribeNotifications({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth }, lang });
}

/** Re-tag this device's subscription when the UI language changes. Returns the unsubscribe function. */
export function watchPushLanguage(): () => void {
  return useI18n.subscribe((state, previous) => {
    if (state.lang === previous.lang || !pushSupported() || Notification.permission !== 'granted') return;
    void currentPushSubscription()
      .then((subscription) => (subscription ? registerPushSubscription(subscription, state.lang) : undefined))
      .catch(() => undefined);
  });
}
