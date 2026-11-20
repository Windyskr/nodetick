import { useEffect, useState } from 'react';
import { BellRing, Loader2, Send, X } from 'lucide-react';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import type { NotificationConfig, NotificationSettings } from '../../lib/types';
import { useI18n, useT, useTF, type Key } from '../../i18n';
import { currentPushSubscription, pushSupported, registerPushSubscription } from '../../lib/push';
import { useEscape } from '../../lib/useEscape';

interface Props {
  onClose: () => void;
}

const fallbackSettings = (): NotificationSettings => ({
  enabled: false,
  taskEnabled: true,
  habitEnabled: true,
  countdownEnabled: true,
  soundEnabled: true,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  allDayTime: '09:00',
  digestEnabled: false,
  digestTime: '08:00',
});

function applicationKey(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  return bytes.buffer;
}

async function workerRegistration(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  return registration;
}

/** Detach this browser before logout so another user of the profile cannot
 * receive notifications belonging to the previous account. */
export async function unsubscribeCurrentBrowser(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await api.unsubscribeNotifications(subscription.endpoint);
  await subscription.unsubscribe();
}

export default function NotificationSettingsDialog({ onClose }: Props) {
  useEscape(onClose);
  const [config, setConfig] = useState<NotificationConfig | null>(null);
  const [settings, setSettings] = useState<NotificationSettings>(fallbackSettings);
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification === 'undefined' ? 'denied' : Notification.permission,
  );
  const t = useT();
  const f = useTF();
  const [busy, setBusy] = useState(false);
  // Status line: a translated success message, or a raw error text.
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const done = (key: Key) => setMessage({ text: t(key), ok: true });
  const fail = (error: unknown) => setMessage({ text: errorMessage(error), ok: false });
  const lang = useI18n((s) => s.lang);
  // Whether THIS browser receives pushes. Turning it off only detaches this
  // device; other devices keep their subscriptions.
  const [deviceOn, setDeviceOn] = useState(false);
  const supported = pushSupported();
  const anyDevice = deviceOn || (config?.subscribedDevices ?? 0) > 0;

  useEffect(() => {
    let active = true;
    void (async () => {
      // Refresh this device's server record (and language) first, so the
      // device count below includes it.
      const subscription = await currentPushSubscription().catch(() => null);
      const here = !!subscription && Notification.permission === 'granted';
      if (here && subscription) await registerPushSubscription(subscription, useI18n.getState().lang).catch(() => undefined);
      const next = await api.notificationConfig();
      if (!active) return;
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || next.settings.timezone;
      setDeviceOn(here);
      setConfig(next);
      setSettings({ ...next.settings, timezone, enabled: next.settings.enabled || here });
      // Older builds switched notifications off for the whole account from one
      // device; a subscribed device means the account should be on.
      if (here && !next.settings.enabled) {
        void api.updateNotificationSettings({ ...next.settings, timezone, enabled: true }).catch(() => undefined);
      }
    })().catch((error: Error) => active && fail(error));
    return () => { active = false; };
  }, []);

  const persist = async (next: NotificationSettings) => {
    setSettings(next);
    await api.updateNotificationSettings(next);
  };

  const refreshDevices = async () => {
    const next = await api.notificationConfig();
    setConfig((current) => (current ? { ...current, subscribedDevices: next.subscribedDevices } : next));
  };

  const enable = async () => {
    if (!supported || !config?.configured) return;
    setBusy(true);
    setMessage(null);
    try {
      const granted = await Notification.requestPermission();
      setPermission(granted);
      if (granted !== 'granted') throw new Error(t('notifyPermissionDenied'));
      const registration = await workerRegistration();
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationKey(config.publicKey),
        });
      }
      await registerPushSubscription(subscription, lang);
      if (!settings.enabled) await persist({ ...settings, enabled: true });
      setDeviceOn(true);
      await refreshDevices();
      done('notifyEnabled');
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setMessage(null);
    try {
      // Detach only this browser. The account-wide switch stays on so the
      // user's other devices keep receiving reminders.
      if (supported) await unsubscribeCurrentBrowser();
      setDeviceOn(false);
      await refreshDevices();
      done('notifyDisabled');
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const change = async <K extends keyof NotificationSettings>(key: K, value: NotificationSettings[K]) => {
    const next = { ...settings, [key]: value };
    setMessage(null);
    try {
      await persist(next);
    } catch (error) {
      fail(error);
    }
  };

  const test = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.testNotification();
      if (result.sent > 0) done('notifyTestSent');
      else setMessage({ text: t('notifyNoDevice'), ok: false });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/20 px-4" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-title"
        className="w-full max-w-[460px] overflow-hidden rounded-2xl border border-line bg-white shadow-[0_18px_60px_rgba(0,0,0,.18)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-2.5">
            <BellRing size={20} className="text-tt" />
            <div>
              <h2 id="notification-title" className="text-[16px] font-semibold">{t('notifyTitle')}</h2>
              <p className="mt-0.5 text-[11px] text-ink-3">{t('notifySubtitle')}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-ink-3 hover:bg-hover hover:text-ink" aria-label={t('close')}>
            <X size={18} />
          </button>
        </header>

        {!config ? (
          <div className="flex h-48 items-center justify-center"><Loader2 size={20} className="animate-spin text-tt" /></div>
        ) : (
          <div className="p-5">
            {!supported && <Notice text={t('notifyUnsupported')} />}
            {supported && !config.configured && <Notice text={t('notifyNotConfigured')} />}
            {permission === 'denied' && <Notice text={t('notifyBlocked')} />}

            <div className="mb-4 flex items-center justify-between rounded-xl bg-hover px-4 py-3">
              <div>
                <div className="text-[14px] font-medium">{t('notifyThisDevice')}</div>
                <div className="mt-0.5 text-[11px] text-ink-3">
                  {deviceOn
                    ? f('notifyOnDevices', config.subscribedDevices)
                    : config.subscribedDevices > 0 ? f('notifyOtherDevices', config.subscribedDevices) : t('notifyOff')}
                </div>
              </div>
              <button
                type="button"
                disabled={busy || !supported || !config.configured || permission === 'denied'}
                onClick={() => void (deviceOn ? disable() : enable())}
                className={`flex h-7 w-12 items-center rounded-full p-0.5 transition-colors disabled:opacity-40 ${deviceOn ? 'justify-end bg-tt' : 'justify-start bg-[#d8dadd]'}`}
                role="switch"
                aria-checked={deviceOn}
              >
                <span className="h-6 w-6 rounded-full bg-white shadow-sm" />
              </button>
            </div>

            <div className={anyDevice ? '' : 'pointer-events-none opacity-45'}>
              <SettingRow label={t('notifyTasks')} checked={settings.taskEnabled} onChange={(value) => void change('taskEnabled', value)} />
              <SettingRow label={t('notifyHabits')} checked={settings.habitEnabled} onChange={(value) => void change('habitEnabled', value)} />
              <SettingRow label={t('notifyCountdowns')} checked={settings.countdownEnabled} onChange={(value) => void change('countdownEnabled', value)} />
              <SettingRow label={t('notifySound')} checked={settings.soundEnabled} onChange={(value) => void change('soundEnabled', value)} />
              <label className="flex items-center justify-between border-t border-line px-1 py-3 text-[13px]">
                <span>{t('notifyAllDayTime')}</span>
                <input
                  type="time"
                  value={settings.allDayTime}
                  onChange={(event) => void change('allDayTime', event.target.value)}
                  className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-tt"
                />
              </label>
              <SettingRow label={t('notifyDigest')} checked={settings.digestEnabled} onChange={(value) => void change('digestEnabled', value)} />
              {settings.digestEnabled && (
                <label className="flex items-center justify-between px-1 pb-3 text-[12px] text-ink-3">
                  <span className="pr-3">{t('notifyDigestHint')}</span>
                  <input
                    type="time"
                    value={settings.digestTime}
                    aria-label={t('notifyDigestTime')}
                    onChange={(event) => { if (event.target.value) void change('digestTime', event.target.value); }}
                    className="shrink-0 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-tt"
                  />
                </label>
              )}
            </div>

            <div className="mt-4 flex min-h-9 items-center justify-between border-t border-line pt-4">
              <span className={`text-[11px] ${message?.ok ? 'text-[#3a8f68]' : 'text-[#b45b5b]'}`}>{message?.text}</span>
              <button
                type="button"
                disabled={busy || !anyDevice}
                onClick={() => void test()}
                className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12px] hover:bg-hover disabled:opacity-40"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} {t('notifySendTest')}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return <div className="mb-3 rounded-lg border border-[#f0d8b8] bg-[#fff9ef] px-3 py-2 text-[11px] leading-5 text-[#8a6330]">{text}</div>;
}

function SettingRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-center justify-between border-t border-line px-1 py-3 text-left text-[13px] first:border-0">
      <span>{label}</span>
      <span className={`flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${checked ? 'justify-end bg-tt' : 'justify-start bg-[#d8dadd]'}`}>
        <span className="h-4 w-4 rounded-full bg-white shadow-sm" />
      </span>
    </button>
  );
}
