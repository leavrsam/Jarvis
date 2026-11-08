// Browser side of push notifications (api/push.js + public/sw.js): register the service worker,
// turn notifications on/off for this device, send a test, and hear about notifications while
// Jarvis is open.
import { notifyAuthRequired } from './auth';

export interface PushNote {
  title: string;
  body: string;
  url: string;
  priority: number;
  tags: string[];
  tag: string;
  speak: boolean;
  id?: string;
  at?: string;
}

export interface PushStatus {
  /** Push API + service workers available in this browser */
  supported: boolean;
  /** iPhone/iPad Safari outside an installed (Home Screen) app: push needs installing first */
  needsInstall: boolean;
  permission: NotificationPermission | 'unsupported';
  /** This device is subscribed */
  subscribed: boolean;
  /** Server has VAPID keys and a device store */
  serverConfigured: boolean;
  missing: string[];
  devices: { id: string; name: string; createdAt: string; endpointHost: string }[];
  /** Server's VAPID public key (fetched with the status, so "Turn on" needs no network first) */
  publicKey: string | null;
  error?: string;
}

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

let registration: Promise<ServiceWorkerRegistration | null> | null = null;

/** Register /sw.js once (also what makes Jarvis installable). Safe to call often. */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (registration) return registration;
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return (registration = Promise.resolve(null));
  registration = navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
    console.warn('[push] service worker registration failed:', err);
    return null;
  });
  return registration;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function api(method: 'GET' | 'POST', body?: unknown) {
  const res = await fetch('/api/push', {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (res.status === 401) notifyAuthRequired();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { data });
  return data;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registerServiceWorker();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function getPushStatus(): Promise<PushStatus> {
  const supported = pushSupported();
  const status: PushStatus = {
    supported,
    needsInstall: isIos() && !isStandalone(),
    permission: 'Notification' in window ? Notification.permission : 'unsupported',
    subscribed: false,
    serverConfigured: false,
    missing: [],
    devices: [],
    publicKey: null,
  };
  try {
    const data = await api('GET');
    status.serverConfigured = Boolean(data.configured);
    status.missing = data.missing || [];
    status.devices = data.devices || [];
    status.publicKey = data.publicKey || null;
  } catch (err) {
    status.error = (err as Error).message;
  }
  if (supported) {
    const sub = await currentSubscription().catch(() => null);
    status.subscribed = Boolean(sub);
  }
  return status;
}

/** A readable name for this device ("Android phone", "Mac – Chrome") */
function deviceName(): string {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? 'Android' : isIos() ? 'iPhone/iPad' : /Mac OS X/i.test(ua) ? 'Mac' : /Windows/i.test(ua) ? 'Windows' : /Linux/i.test(ua) ? 'Linux' : 'Device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${os} · ${browser}${isStandalone() ? ' (app)' : ''}`;
}

/** Rejects with `message` if `p` hasn't settled within `ms` (p keeps running) */
function within<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

const PERMISSION_HELP =
  'No permission prompt? Allow notifications for Jarvis in the phone settings (long-press the Jarvis icon → App info → Notifications → Allow), or in the browser\'s site settings, then tap Turn on again.';

/**
 * Ask permission, subscribe this device and register it with the server.
 * Must be called straight from a tap: browsers only show the permission prompt during a user
 * gesture, so the permission is requested before anything else is awaited.
 */
export async function enablePush(publicKey: string | null, onStep?: (step: string) => void): Promise<void> {
  if (!pushSupported()) throw new Error('This browser does not support push notifications.');
  // 1. Permission first, while the tap still counts as a user gesture
  onStep?.('Asking for permission…');
  const asked = Notification.permission === 'granted' ? Promise.resolve<NotificationPermission>('granted') : Notification.requestPermission();
  const permission = await within(asked, 15000, PERMISSION_HELP);
  if (permission !== 'granted') throw new Error(permission === 'denied' ? `Notifications are blocked for Jarvis. ${PERMISSION_HELP}` : PERMISSION_HELP);

  // 2. Server key (normally already loaded with the panel)
  let key = publicKey;
  if (!key) {
    onStep?.('Getting the server key…');
    const data = await within(api('GET'), 15000, 'The server took too long to answer. Try again.');
    if (!data.configured || !data.publicKey) throw new Error('Push is not set up on the server yet.');
    key = data.publicKey as string;
  }

  // 3. Subscribe with the browser's push service
  onStep?.('Connecting to the push service…');
  const reg = await registerServiceWorker();
  if (!reg) throw new Error('Service worker unavailable (the page must be served over https).');
  await within(navigator.serviceWorker.ready, 10000, 'The service worker did not start. Reload Jarvis and try again.');
  const keyBytes = urlBase64ToUint8Array(key);
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with a different (old) key can't receive our pushes
  const current = sub?.options?.applicationServerKey;
  if (sub && current && !sameBytes(new Uint8Array(current), keyBytes)) {
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) {
    try {
      sub = await within(
        reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes }),
        20000,
        'The push service did not answer. Check the connection and try again.'
      );
    } catch (err) {
      const msg = (err as Error).message || String(err);
      throw new Error(
        /push service|registration failed/i.test(msg)
          ? `The browser's push service refused (${msg}). On Android: allow notifications for Jarvis (long-press the icon → App info → Notifications) and for Chrome, check Google Play services is up to date, then try again.`
          : msg
      );
    }
  }

  // 4. Tell the server about this device
  onStep?.('Registering this device…');
  await within(api('POST', { action: 'subscribe', subscription: sub.toJSON(), name: deviceName() }), 15000, 'The server took too long to save this device. Try again.');
}

function sameBytes(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (sub) {
    await api('POST', { action: 'unsubscribe', endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
}

export async function removeDevice(id: string): Promise<void> {
  await api('POST', { action: 'unsubscribe', id });
}

export async function sendTestPush(): Promise<{ sent: number; failed: number; removed: number }> {
  return api('POST', { action: 'test' });
}

/** Notifications that arrive while Jarvis is open (from the service worker) */
export function onPushNotification(handler: (note: PushNote) => void): () => void {
  if (!('serviceWorker' in navigator)) return () => {};
  const listener = (e: MessageEvent) => {
    if (e.data?.type === 'jarvis-notification' && e.data.note) handler(e.data.note as PushNote);
  };
  navigator.serviceWorker.addEventListener('message', listener);
  return () => navigator.serviceWorker.removeEventListener('message', listener);
}

// ---------------------------------------------------------------------------- Install as an app

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let installPrompt: BeforeInstallPromptEvent | null = null;
const INSTALL_EVENT = 'jarvis:install-available';

// Chrome / Edge / Android offer installation once the page qualifies; keep the offer for our button
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e as BeforeInstallPromptEvent;
    window.dispatchEvent(new Event(INSTALL_EVENT));
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    window.dispatchEvent(new Event(INSTALL_EVENT));
  });
}

export const canPromptInstall = () => installPrompt !== null;

export function onInstallAvailabilityChange(handler: () => void): () => void {
  window.addEventListener(INSTALL_EVENT, handler);
  return () => window.removeEventListener(INSTALL_EVENT, handler);
}

/** Show the browser's install dialog. Resolves true if installed. */
export async function promptInstall(): Promise<boolean> {
  const p = installPrompt;
  if (!p) return false;
  await p.prompt();
  const { outcome } = await p.userChoice;
  installPrompt = null;
  window.dispatchEvent(new Event(INSTALL_EVENT));
  return outcome === 'accepted';
}

/** How to install here when the browser hasn't offered a button */
export function installHint(): string {
  const ua = navigator.userAgent;
  if (isIos()) return 'In Safari: Share button → "Add to Home Screen".';
  if (/Android/i.test(ua)) return 'In Chrome: ⋮ menu → "Add to Home screen" → Install.';
  if (/Edg\//.test(ua)) return 'In Edge: … menu → Apps → "Install this site as an app".';
  if (/Chrome\//.test(ua)) return 'In Chrome: the install icon at the right of the address bar, or ⋮ menu → "Cast, save and share" → "Install page as app".';
  if (/Safari\//.test(ua)) return 'In Safari (macOS Sonoma or later): File → "Add to Dock".';
  return 'Open Jarvis in Chrome or Edge to install it as an app.';
}
