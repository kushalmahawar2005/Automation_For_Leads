import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode';

// Global types to prevent re-initialization in Next.js development
declare global {
  var waClient: Client | undefined;
  var waQrCode: string | null;
  var waStatus: 'INITIALIZING' | 'QR_READY' | 'AUTHENTICATED' | 'READY' | 'DISCONNECTED' | 'ERROR';
}

// Initialize state
if (!global.waStatus) {
  global.waStatus = 'DISCONNECTED';
  global.waQrCode = null;
}

export const getWhatsAppStatus = () => {
  return {
    status: global.waStatus,
    qr: global.waQrCode,
  };
};

export const initWhatsApp = async () => {
  if (global.waClient && global.waStatus !== 'DISCONNECTED' && global.waStatus !== 'ERROR') {
    return; // Already initialized or initializing
  }

  console.log("Initializing WhatsApp Client...");
  global.waStatus = 'INITIALIZING';
  global.waQrCode = null;

  try {
    const client = new Client({
      authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
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
          '--disable-gpu'
        ]
      }
    });

    client.on('qr', async (qr) => {
      console.log('QR Received, converting to base64...');
      try {
        global.waQrCode = await qrcode.toDataURL(qr);
        global.waStatus = 'QR_READY';
      } catch (e) {
        console.error('Failed to generate QR base64', e);
      }
    });

    client.on('authenticated', () => {
      console.log('WhatsApp Authenticated!');
      global.waStatus = 'AUTHENTICATED';
      global.waQrCode = null; // Clear QR code
    });

    client.on('ready', () => {
      console.log('WhatsApp Client is READY!');
      global.waStatus = 'READY';
    });

    client.on('disconnected', (reason) => {
      console.log('WhatsApp Client Disconnected', reason);
      global.waStatus = 'DISCONNECTED';
      global.waClient = undefined;
    });

    await client.initialize();
    global.waClient = client;

  } catch (error) {
    console.error("Error initializing WhatsApp:", error);
    global.waStatus = 'ERROR';
    global.waClient = undefined;
  }
};

export const getClient = () => {
  return global.waClient;
};
