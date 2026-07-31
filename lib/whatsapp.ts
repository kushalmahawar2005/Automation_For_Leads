import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode';
import fs from 'fs';
import path from 'path';

export type WaStatus =
  | 'INITIALIZING'
  | 'QR_READY'
  | 'AUTHENTICATED'
  | 'READY'
  | 'DISCONNECTED'
  | 'ERROR';

type ClientState = {
  client?: Client;
  qr: string | null;
  status: WaStatus;
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

function getExecutablePath(): string | undefined {
  return (
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    process.env.CHROME_PATH ||
    process.env.CHROMIUM_PATH ||
    undefined
  );
}

function ensureState(userId: string): ClientState {
  let state = clients.get(userId);
  if (!state) {
    state = { qr: null, status: 'DISCONNECTED' };
    clients.set(userId, state);
  }
  return state;
}

function cleanSessionLocks(userId: string) {
  try {
    const sessionDir = path.join(AUTH_PATH, `session-${userId}`);
    if (fs.existsSync(sessionDir)) {
      const locks = [
        path.join(sessionDir, 'SingletonLock'),
        path.join(sessionDir, 'DevToolsActivePort'),
        path.join(sessionDir, 'Default', 'SingletonLock'),
        path.join(sessionDir, 'Default', 'DevToolsActivePort'),
      ];
      for (const l of locks) {
        if (fs.existsSync(l)) {
          try { fs.unlinkSync(l); } catch {}
        }
      }
    }
  } catch (e) {
    console.warn('Failed to clean session locks:', e);
  }
}

export function getWhatsAppStatus(userId: string) {
  const state = ensureState(userId);
  return { status: state.status, qr: state.qr };
}

export function getClient(userId: string): Client | undefined {
  return clients.get(userId)?.client;
}

export async function initWhatsApp(userId: string): Promise<void> {
  const state = ensureState(userId);
  if (state.status === 'READY' || state.status === 'QR_READY' || state.status === 'AUTHENTICATED') {
    return;
  }

  // Prevent multiple concurrent initialization calls for the same user
  if (initPromises.has(userId)) {
    return initPromises.get(userId)!;
  }

  const promise = (async () => {
    console.log(`Initializing WhatsApp Client for user ${userId}...`);
    state.status = 'INITIALIZING';
    state.qr = null;

    try {
      if (state.client) {
        try {
          await state.client.destroy();
        } catch (e) {
          console.warn('Failed to destroy previous client', e);
        }
        state.client = undefined;
      }

      cleanSessionLocks(userId);

      const executablePath = getExecutablePath();
      const headless: boolean =
        process.env.PUPPETEER_HEADLESS === 'false' ? false : true;

      const client = new Client({
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
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
          ],
        },
      });

      client.on('qr', async (qr) => {
        try {
          state.qr = await qrcode.toDataURL(qr);
          state.status = 'QR_READY';
        } catch (e) {
          console.error('QR encoding failed', e);
        }
      });

      client.on('authenticated', () => {
        state.status = 'AUTHENTICATED';
        state.qr = null;
      });

      client.on('ready', () => {
        state.status = 'READY';
      });

      client.on('auth_failure', (message) => {
        console.error(`WhatsApp auth failure for ${userId}:`, message);
        state.status = 'ERROR';
        state.client = undefined;
        state.qr = null;
        try {
          const sessionDir = path.join(AUTH_PATH, `session-${userId}`);
          if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
          }
        } catch (err) {
          console.error('Failed to clean session dir', err);
        }
      });

      client.on('disconnected', (reason) => {
        console.warn(`WhatsApp disconnected for ${userId}:`, reason);
        state.status = 'DISCONNECTED';
        state.client = undefined;
        state.qr = null;
        setTimeout(() => {
          console.log(`Auto-reconnecting WhatsApp for user ${userId}...`);
          initWhatsApp(userId).catch(console.error);
        }, 3000);
      });

      state.client = client;
      await client.initialize();
    } catch (error: any) {
      console.error(`WhatsApp init error for ${userId}:`, error);
      state.status = 'ERROR';
      state.client = undefined;
      state.qr = null;
      cleanSessionLocks(userId);
    } finally {
      initPromises.delete(userId);
    }
  })();

  initPromises.set(userId, promise);
  return promise;
}

export async function logoutWhatsApp(userId: string): Promise<void> {
  const state = clients.get(userId);
  if (state?.client) {
    try {
      await state.client.logout().catch(() => {});
    } catch (e) {}
    try {
      await state.client.destroy().catch(() => {});
    } catch (e) {}
  }

  if (state) {
    state.client = undefined;
    state.qr = null;
    state.status = 'DISCONNECTED';
  }

  try {
    const sessionDir = path.join(AUTH_PATH, `session-${userId}`);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error('Failed to clean session dir on logout', err);
  }
}
