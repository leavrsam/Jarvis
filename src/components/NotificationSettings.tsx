// Settings: install Jarvis as an app, and push notifications for this device.
import React, { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, Download, Send, Smartphone, Trash2 } from 'lucide-react';
import {
  PushStatus,
  canPromptInstall,
  disablePush,
  enablePush,
  getPushStatus,
  installHint,
  isStandalone,
  onInstallAvailabilityChange,
  promptInstall,
  removeDevice,
  sendTestPush,
} from '../services/push';

const box = 'p-3.5 rounded-xl border border-amber-900/60 bg-black/70 space-y-2.5';
const btn =
  'flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg border text-xs font-orbitron transition-colors disabled:opacity-40';

export const NotificationSettings: React.FC = () => {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [canInstall, setCanInstall] = useState(canPromptInstall());
  const installed = isStandalone();

  const refresh = useCallback(async () => setStatus(await getPushStatus()), []);
  useEffect(() => {
    void refresh();
    return onInstallAvailabilityChange(() => setCanInstall(canPromptInstall()));
  }, [refresh]);

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setMessage('');
    try {
      const msg = await fn();
      if (msg) setMessage(msg);
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  return (
    <>
      {/* Install as an app */}
      <div className={box}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1.5 text-xs font-orbitron text-amber-300">
            <Smartphone className="w-3.5 h-3.5 text-amber-400" />
            <span>JARVIS APP</span>
          </div>
          <span className={`text-[10px] font-orbitron px-2 py-0.5 rounded border ${installed ? 'border-emerald-500/60 text-emerald-300 bg-emerald-950/40' : 'border-amber-900 text-amber-500'}`}>
            {installed ? 'INSTALLED' : 'IN BROWSER'}
          </span>
        </div>
        <p className="text-[11px] text-amber-500/90 font-sans">
          {installed
            ? 'Running as an app: its own window and icon, and notifications open it.'
            : 'Install Jarvis as an app for its own window, a home-screen / dock icon, and notifications.'}
        </p>
        {!installed &&
          (canInstall ? (
            <button
              disabled={busy}
              onClick={() => run(async () => ((await promptInstall()) ? 'Installed.' : ''))}
              className={`${btn} w-full border-amber-500/60 bg-amber-950/40 hover:bg-amber-900/50 text-amber-200`}
            >
              <Download className="w-3.5 h-3.5" /> INSTALL JARVIS
            </button>
          ) : (
            <p className="text-[11px] text-amber-300/90 font-sans">{installHint()}</p>
          ))}
      </div>

      {/* Push notifications */}
      <div className={box}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1.5 text-xs font-orbitron text-amber-300">
            <Bell className="w-3.5 h-3.5 text-amber-400" />
            <span>NOTIFICATIONS</span>
          </div>
          <span
            className={`text-[10px] font-orbitron px-2 py-0.5 rounded border ${
              status?.subscribed ? 'border-emerald-500/60 text-emerald-300 bg-emerald-950/40' : 'border-amber-900 text-amber-500'
            }`}
          >
            {status?.subscribed ? 'ON (THIS DEVICE)' : 'OFF'}
          </span>
        </div>

        {!status ? (
          <p className="text-[11px] text-amber-500/80 font-sans">Checking…</p>
        ) : !status.serverConfigured ? (
          <p className="text-[11px] text-amber-400/90 font-sans">
            {status.error === 'unauthorized' ? 'Log in again to set up notifications.' : (
              <>
                Not set up on the server yet. Add in Vercel → Settings → Environment Variables:{' '}
                <span className="font-mono-tech text-amber-300">{status.missing.join(', ') || 'VAPID keys and a Redis store'}</span> (see README), then redeploy.
              </>
            )}
          </p>
        ) : !status.supported ? (
          <p className="text-[11px] text-amber-400/90 font-sans">This browser can't receive push notifications.</p>
        ) : status.needsInstall ? (
          <p className="text-[11px] text-amber-400/90 font-sans">
            On iPhone and iPad, notifications work once Jarvis is added to the Home Screen (Share → "Add to Home Screen"). Open it from there, then turn them on here.
          </p>
        ) : (
          <>
            <p className="text-[11px] text-amber-500/90 font-sans">
              Alerts from n8n (reminders, alarms, anything you automate) arrive on this device even when Jarvis is closed.
            </p>
            {status.permission === 'denied' && (
              <p className="text-[11px] text-red-300/90 font-sans">Notifications are blocked for this site. Allow them in the browser's site settings, then try again.</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              {status.subscribed ? (
                <button
                  disabled={busy}
                  onClick={() => run(async () => {
                    await disablePush();
                    return 'Notifications off for this device.';
                  })}
                  className={`${btn} border-amber-800/60 bg-black/60 hover:bg-amber-950/40 text-amber-300`}
                >
                  <BellOff className="w-3.5 h-3.5" /> TURN OFF
                </button>
              ) : (
                <button
                  disabled={busy || status.permission === 'denied'}
                  onClick={() => run(async () => {
                    await enablePush();
                    return 'Notifications on for this device.';
                  })}
                  className={`${btn} border-amber-500/60 bg-amber-950/40 hover:bg-amber-900/50 text-amber-200`}
                >
                  <Bell className="w-3.5 h-3.5" /> TURN ON
                </button>
              )}
              <button
                disabled={busy || status.devices.length === 0}
                onClick={() => run(async () => {
                  const r = await sendTestPush();
                  return `Test sent to ${r.sent} device${r.sent === 1 ? '' : 's'}${r.failed ? `, ${r.failed} failed` : ''}${r.removed ? `, ${r.removed} expired removed` : ''}.`;
                })}
                className={`${btn} border-amber-800/60 bg-black/60 hover:bg-amber-950/40 text-amber-300`}
              >
                <Send className="w-3.5 h-3.5" /> SEND TEST
              </button>
            </div>
          </>
        )}

        {message && <p className="text-[11px] text-amber-200 font-sans">{message}</p>}

        {status && status.devices.length > 0 && (
          <div className="pt-2 border-t border-amber-900/50 space-y-1">
            <div className="text-[10px] text-amber-500">DEVICES RECEIVING NOTIFICATIONS</div>
            {status.devices.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 text-[11px] font-sans text-amber-200">
                <span className="truncate">{d.name}</span>
                <button
                  onClick={() => run(async () => {
                    await removeDevice(d.id);
                  })}
                  className="p-1.5 rounded text-amber-600 hover:text-red-300"
                  title={`Stop notifications to ${d.name}`}
                  aria-label={`Remove ${d.name}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
};
