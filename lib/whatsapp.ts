import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { closeBrowser, withTimeout } from './runtime-control';
import { browserExecutablePath } from './browser';

export type WaStatus =
  | 'INITIALIZING'
  | 'QR_READY'
  | 'AUTHENTICATED'
  | 'READY'
  | 'DISCONNECTED'
  | 'ERROR';

type ClientState = {
  client?: Client;
  enabled: boolean;
  cleanup?: Promise<void>;
  qr: string | null;
  status: WaStatus;
  /** Failed init attempts in a row; drives the retry backoff. */
  failures: number;
  /** Epoch ms before which no new browser may be launched. */
  nextAttemptAt: number;
  /** Pending auto-reconnect timer, so we never stack multiple. */
  retryTimer?: ReturnType<typeof setTimeout>;
};

declare global {
  // eslint-disable-next-line no-var
  var waClients: Map<string, ClientState> | undefined;
  // eslint-disable-next-line no-var
  var waInitPromises: Map<string, Promise<void>> | undefined;
}

const clients: Map<string, ClientState> =
  global.waClients ?? (global.waClients = new Map());

const initPromises: Map<string, Promise<void>> =
  global.waInitPromises ?? (global.waInitPromises = new Map());

const AUTH_PATH =
  process.env.WWEBJS_AUTH_PATH ||
  process.env.WWEBJS_AUTH_DIR ||
  '.wwebjs_auth';

/** Backoff between launch attempts: 15s, 30s, 60s ... capped at 5 min. */
const BASE_RETRY_MS = 15_000;
const MAX_RETRY_MS = 5 * 60_000;

function retryDelay(failures: number): number {
  return Math.min(BASE_RETRY_MS * 2 ** Math.max(0, failures - 1), MAX_RETRY_MS);
}

function getExecutablePath(): string | undefined {
  return browserExecutablePath();
}

function ensureState(userId: string): ClientState {
  let state = clients.get(userId);
  if (!state) {
    state = { enabled: false, qr: null, status: 'DISCONNECTED', failures: 0, nextAttemptAt: 0 };
    clients.set(userId, state);
  }
  return state;
}

async function hardDestroy(client?: Client): Promise<void> {
  if (!client) return;
  // Ignore late events from a client that no longer owns this user's state.
  client.removeAllListeners();
  const browser = client.pupBrowser;
  try {
    await withTimeout(client.destroy(), 5000);
  } catch (error) {
    console.warn('WhatsApp destroy failed or timed out', error);
  }
  await closeBrowser(browser);
}

function clearRetry(state: ClientState) {
  clearTimeout(state.retryTimer);
  state.retryTimer = undefined;
}

function retireClient(state: ClientState, client?: Client): Promise<void> {
  const previous = state.cleanup;
  const cleanup = (async () => {
    await previous;
    await hardDestroy(client);
  })();
  state.cleanup = cleanup;
  // Keep a rejected cleanup in state: launching another browser is unsafe until
  // the previous browser's termination has been confirmed.
  void cleanup.then(() => {
    if (state.cleanup === cleanup) state.cleanup = undefined;
  }, () => {});
  return cleanup;
}

export function getWhatsAppStatus(userId: string) {
  const state = ensureState(userId);
  return { status: state.status, qr: state.qr };
}

export function getClient(userId: string): Client | undefined {
  return clients.get(userId)?.client;
}

function scheduleReconnect(userId: string, state: ClientState) {
  if (!state.enabled || state.retryTimer) return;
  const delay = retryDelay(state.failures + 1);
  state.retryTimer = setTimeout(() => {
    state.retryTimer = undefined;
    console.log(`Auto-reconnecting WhatsApp for user ${userId}...`);
    initWhatsApp(userId).catch(console.error);
  }, delay);
}

export function connectWhatsApp(userId: string): void {
  const state = ensureState(userId);
  state.enabled = true;
  void initWhatsApp(userId).catch(console.error);
}

export async function initWhatsApp(userId: string): Promise<void> {
  const state = ensureState(userId);
  if (!state.enabled) return;
  if (state.status === 'READY' || state.status === 'QR_READY' || state.status === 'AUTHENTICATED') {
    return;
  }

  // Prevent multiple concurrent initialization calls for the same user
  if (initPromises.has(userId)) {
    return initPromises.get(userId)!;
  }

  // Status polling hits this route every few seconds; without a cooldown a
  // failing session would launch a new Chrome on every poll.
  if (Date.now() < state.nextAttemptAt) {
    return;
  }
  state.nextAttemptAt = Date.now() + retryDelay(state.failures + 1);

  const promise = (async () => {
    console.log(`Initializing WhatsApp Client for user ${userId}...`);
    state.status = 'INITIALIZING';
    state.qr = null;

    let client: Client | undefined;
    try {
      await state.cleanup;
      if (!state.enabled) return;
      await hardDestroy(state.client);
      state.client = undefined;
      // Chromium owns its profile locks. Never delete locks of a live process.

      const executablePath = getExecutablePath();
      const headless: boolean =
        process.env.PUPPETEER_HEADLESS === 'false' ? false : true;

      client = new Client({
        authStrategy: new LocalAuth({
          clientId: userId,
          dataPath: AUTH_PATH,
        }),
        webVersionCache: {
          type: 'remote',
          remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1014721034-alpha.html',
        },
        puppeteer: {
          headless,
          executablePath,
          timeout: 30_000,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--disable-gpu',
          ],
        },
      });

      const current = () => state.enabled && state.client === client;
      client.on('qr', async (qr) => {
        try {
          const encoded = await qrcode.toDataURL(qr);
          if (!current()) return;
          state.qr = encoded;
          state.status = 'QR_READY';
        } catch (e) {
          console.error('QR encoding failed', e);
        }
      });

      client.on('authenticated', () => {
        if (!current()) return;
        state.status = 'AUTHENTICATED';
        state.qr = null;
      });

      client.on('ready', () => {
        if (!current()) return;
        clearRetry(state);
        state.status = 'READY';
        state.failures = 0;
        state.nextAttemptAt = 0;
      });

      const disconnected = (status: 'ERROR' | 'DISCONNECTED') => {
        if (!current()) return;
        state.status = status;
        state.client = undefined;
        state.qr = null;
        state.failures += 1;
        state.nextAttemptAt = Date.now() + retryDelay(state.failures);
        void retireClient(state, client).then(
          () => scheduleReconnect(userId, state),
          (error) => { state.status = 'ERROR'; console.error(error); },
        );
      };
      client.on('auth_failure', () => disconnected('ERROR'));
      client.on('disconnected', () => disconnected('DISCONNECTED'));

      state.client = client;
      const initializing = client.initialize();
      // If a timed-out initialization completes late, dispose of its browser.
      void initializing.then(async () => {
        if (!current()) await hardDestroy(client);
      }, () => {}).catch(console.error);
      await withTimeout(initializing, 90_000);
    } catch (error: unknown) {
      console.error(`WhatsApp init error for ${userId}:`, error);
      if (state.client === client) {
        state.status = state.enabled ? 'ERROR' : 'DISCONNECTED';
        state.qr = null;
        state.client = undefined;
        state.failures += 1;
        state.nextAttemptAt = Date.now() + retryDelay(state.failures);
        await retireClient(state, client);
      }
      scheduleReconnect(userId, state);
    } finally {
      initPromises.delete(userId);
    }
  })();

  initPromises.set(userId, promise);
  return promise;
}

export async function logoutWhatsApp(userId: string): Promise<void> {
  const state = ensureState(userId);
  // Disable reconnect before logout can emit a disconnected event.
  state.enabled = false;
  clearRetry(state);
  const client = state.client;
  state.client = undefined;
  state.qr = null;
  state.status = 'DISCONNECTED';
  client?.removeAllListeners();
  const cleanup = retireClient(state, client);
  await cleanup;
  // Initialization may have been waiting for an older cleanup or launching.
  await initPromises.get(userId);
  await state.cleanup;
  clearRetry(state);
  state.failures = 0;
  state.nextAttemptAt = 0;
  const sessionDir = path.join(AUTH_PATH, `session-${userId}`);
  fs.rmSync(sessionDir, { recursive: true, force: true });
}
