import { useEffect, useState } from 'react';
import { BellRing, Loader2, Send, X } from 'lucide-react';
import { api } from '../../lib/api';
import type { NotificationConfig, NotificationSettings } from '../../lib/types';

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
  const [config, setConfig] = useState<NotificationConfig | null>(null);
  const [settings, setSettings] = useState<NotificationSettings>(fallbackSettings);
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification === 'undefined' ? 'denied' : Notification.permission,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const supported = typeof Notification !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;

  useEffect(() => {
    let active = true;
    void api.notificationConfig().then((next) => {
      if (!active) return;
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || next.settings.timezone;
      setConfig(next);
      setSettings({ ...next.settings, timezone });
    }).catch((error: Error) => active && setMessage(error.message));
    return () => { active = false; };
  }, []);

  const persist = async (next: NotificationSettings) => {
    setSettings(next);
    await api.updateNotificationSettings(next);
  };

  const enable = async () => {
    if (!supported || !config?.configured) return;
    setBusy(true);
    setMessage('');
    try {
      const granted = await Notification.requestPermission();
      setPermission(granted);
      if (granted !== 'granted') throw new Error('浏览器未授予通知权限。');
      const registration = await workerRegistration();
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationKey(config.publicKey),
        });
      }
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('浏览器返回了无效的推送订阅。');
      await api.subscribeNotifications({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
      const next = { ...settings, enabled: true };
      await persist(next);
      setConfig({ ...config, subscribedDevices: Math.max(1, config.subscribedDevices), settings: next });
      setMessage('通知已开启。');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setMessage('');
    try {
      if (supported) await unsubscribeCurrentBrowser();
      const next = { ...settings, enabled: false };
      await persist(next);
      if (config) setConfig({ ...config, subscribedDevices: Math.max(0, config.subscribedDevices - 1), settings: next });
      setMessage('通知已关闭。');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const change = async <K extends keyof NotificationSettings>(key: K, value: NotificationSettings[K]) => {
    const next = { ...settings, [key]: value };
    setMessage('');
    try {
      await persist(next);
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const test = async () => {
    setBusy(true);
    setMessage('');
    try {
      const result = await api.testNotification();
      setMessage(result.sent > 0 ? '测试通知已发送。' : '没有可用的通知设备。');
    } catch (error) {
      setMessage((error as Error).message);
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
              <h2 id="notification-title" className="text-[16px] font-semibold">通知与提醒</h2>
              <p className="mt-0.5 text-[11px] text-ink-3">关闭页面后也能收到任务、习惯和纪念日提醒</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-ink-3 hover:bg-hover hover:text-ink" aria-label="关闭">
            <X size={18} />
          </button>
        </header>

        {!config ? (
          <div className="flex h-48 items-center justify-center"><Loader2 size={20} className="animate-spin text-tt" /></div>
        ) : (
          <div className="p-5">
            {!supported && <Notice text="当前浏览器不支持 Web Push 通知。" />}
            {supported && !config.configured && <Notice text="服务端尚未配置 VAPID 密钥。请按 README 配置后再开启通知。" />}
            {permission === 'denied' && <Notice text="通知权限已被浏览器阻止，请在网站权限设置中重新允许。" />}

            <div className="mb-4 flex items-center justify-between rounded-xl bg-[#f7f8fa] px-4 py-3">
              <div>
                <div className="text-[14px] font-medium">浏览器通知</div>
                <div className="mt-0.5 text-[11px] text-ink-3">
                  {settings.enabled ? `已开启 · ${config.subscribedDevices} 台设备` : '未开启'}
                </div>
              </div>
              <button
                type="button"
                disabled={busy || !supported || !config.configured || permission === 'denied'}
                onClick={() => void (settings.enabled ? disable() : enable())}
                className={`flex h-7 w-12 items-center rounded-full p-0.5 transition-colors disabled:opacity-40 ${settings.enabled ? 'justify-end bg-tt' : 'justify-start bg-[#d8dadd]'}`}
                role="switch"
                aria-checked={settings.enabled}
              >
                <span className="h-6 w-6 rounded-full bg-white shadow-sm" />
              </button>
            </div>

            <div className={settings.enabled ? '' : 'pointer-events-none opacity-45'}>
              <SettingRow label="任务提醒" checked={settings.taskEnabled} onChange={(value) => void change('taskEnabled', value)} />
              <SettingRow label="习惯打卡提醒" checked={settings.habitEnabled} onChange={(value) => void change('habitEnabled', value)} />
              <SettingRow label="纪念日提醒" checked={settings.countdownEnabled} onChange={(value) => void change('countdownEnabled', value)} />
              <SettingRow label="通知提示音" checked={settings.soundEnabled} onChange={(value) => void change('soundEnabled', value)} />
              <label className="flex items-center justify-between border-t border-line px-1 py-3 text-[13px]">
                <span>全天事项提醒时间</span>
                <input
                  type="time"
                  value={settings.allDayTime}
                  onChange={(event) => void change('allDayTime', event.target.value)}
                  className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-tt"
                />
              </label>
            </div>

            <div className="mt-4 flex min-h-9 items-center justify-between border-t border-line pt-4">
              <span className={`text-[11px] ${message.includes('已') ? 'text-[#3a8f68]' : 'text-[#b45b5b]'}`}>{message}</span>
              <button
                type="button"
                disabled={busy || !settings.enabled}
                onClick={() => void test()}
                className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12px] hover:bg-hover disabled:opacity-40"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} 发送测试通知
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
