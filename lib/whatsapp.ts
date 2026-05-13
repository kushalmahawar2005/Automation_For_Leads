import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode';

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
}

const clients: Map<string, ClientState> =
  global.waClients ?? (global.waClients = new Map());

function ensureState(userId: string): ClientState {
  let state = clients.get(userId);
  if (!state) {
    state = { qr: null, status: 'DISCONNECTED' };
    clients.set(userId, state);
  }
  return state;
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
  if (state.client && state.status !== 'DISCONNECTED' && state.status !== 'ERROR') {
    return;
  }

  console.log(`Initializing WhatsApp Client for user ${userId}...`);
  state.status = 'INITIALIZING';
  state.qr = null;

  try {
    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: userId,
        dataPath: '.wwebjs_auth',
      }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
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

    client.on('disconnected', () => {
      state.status = 'DISCONNECTED';
      state.client = undefined;
    });

    state.client = client;
    await client.initialize();
  } catch (error) {
    console.error(`WhatsApp init error for ${userId}:`, error);
    state.status = 'ERROR';
    state.client = undefined;
  }
}

export async function logoutWhatsApp(userId: string): Promise<void> {
  const state = clients.get(userId);
  if (!state?.client) return;
  try {
    await state.client.logout();
  } catch (e) {
    console.error(`Logout error for ${userId}:`, e);
  }
  state.client = undefined;
  state.qr = null;
  state.status = 'DISCONNECTED';
}
