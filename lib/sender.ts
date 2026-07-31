import { MessageMedia } from "whatsapp-web.js";
import type { Lead, Settings } from "@prisma/client";
import { prisma } from "./db";
import { getClient, getWhatsAppStatus } from "./whatsapp";

// ---------------------------------------------------------------------------
// Anti-ban bulk sender.
//
// WhatsApp bans automation that behaves like a bot: bursts of identical
// messages, sending to numbers that aren't on WhatsApp, and 24/7 blasting.
// This engine defends against that with: randomized human-like delays, a
// per-day cap, batch cool-downs, "typing" simulation, number validation, and
// an automatic stop when messages start failing (a strong block signal).
//
// A campaign runs in-memory on the server (single-instance deploy), so it
// keeps going even if the user closes the browser tab. Progress is polled.
// ---------------------------------------------------------------------------

export type CampaignItem = {
  leadId: string;
  name: string;
  phone: string;
  status: "PENDING" | "SENT" | "FAILED" | "INVALID" | "SKIPPED";
  error?: string;
  at?: number;
};

export type CampaignState = {
  running: boolean;
  total: number;
  sent: number;
  failed: number;
  invalid: number;
  skipped: number;
  processed: number;
  currentName?: string;
  startedAt: number;
  finishedAt?: number;
  nextSendAt?: number;
  stopRequested: boolean;
  stopReason?: string;
  dailyCap: number;
  dailySentToday: number;
  items: CampaignItem[];
};

declare global {
  // eslint-disable-next-line no-var
  var waCampaigns: Map<string, CampaignState> | undefined;
}

const campaigns: Map<string, CampaignState> =
  global.waCampaigns ?? (global.waCampaigns = new Map());

export function getCampaign(userId: string): CampaignState | null {
  return campaigns.get(userId) ?? null;
}

export function stopCampaign(userId: string): boolean {
  const c = campaigns.get(userId);
  if (c && c.running) {
    c.stopRequested = true;
    return true;
  }
  return false;
}

// ---- helpers ----

const DEFAULTS = {
  dailyCap: 40,
  minDelaySec: 8,
  maxDelaySec: 30,
  batchSize: 10,
  batchPauseSec: 90,
  warmup: true,
  validateNumbers: true,
};

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// India-aware normalisation to WhatsApp's digits-only format.
export function normalizePhone(raw: string): string {
  let d = (raw || "").replace(/\D/g, "");
  if (d.startsWith("0091")) d = d.slice(4);
  else if (d.startsWith("091")) d = d.slice(3);
  else if (d.startsWith("0") && d.length === 11) d = d.slice(1);
  if (d.length === 10) d = `91${d}`;
  return d;
}

function isPlausibleNumber(digits: string): boolean {
  return digits.length >= 10 && digits.length <= 15;
}

// Reads correctly in the same sentence slot as a real competitor name, for
// leads where we couldn't find one.
const DEFAULT_COMPETITOR = "a nearby competitor";

// {{competitor}} needs a rival the lead would recognise: same category, same
// area, already has a website. Best-rated one wins; the lead never competes
// with itself. Returns leadId -> competitor name.
export async function buildCompetitorMap(
  userId: string,
  leads: Pick<Lead, "id" | "query" | "location">[]
): Promise<Map<string, string>> {
  const groups = new Map<string, { query: string; location: string; leads: typeof leads }>();
  for (const l of leads) {
    const key = `${l.query}|||${l.location}`;
    const g = groups.get(key) || { query: l.query, location: l.location, leads: [] };
    g.leads.push(l);
    groups.set(key, g);
  }

  const map = new Map<string, string>();
  for (const g of groups.values()) {
    const rivals = (
      await prisma.lead.findMany({
        where: { userId, query: g.query, location: g.location, website: { not: null } },
        orderBy: [{ rating: "desc" }],
        take: 5,
        select: { id: true, name: true, website: true },
      })
    ).filter((r) => r.website && r.website.trim() !== "");

    for (const lead of g.leads) {
      const rival = rivals.find((r) => r.id !== lead.id && r.name);
      if (rival) map.set(lead.id, rival.name);
    }
  }
  return map;
}

// Replace {{var}} tokens with per-lead + sender values.
export function renderTemplate(
  body: string,
  lead: Pick<Lead, "name" | "address" | "phone" | "rating" | "website" | "location" | "query">,
  settings?: Pick<
    Settings,
    "userName" | "userBusiness" | "userProfession" | "portfolioLink"
  > | null,
  fallbackLocation?: string,
  competitor?: string
): string {
  const area = lead.location || fallbackLocation || "";
  const map: Record<string, string> = {
    // The lead's business
    name: lead.name || "",
    business: lead.name || "",
    location: area,
    area,
    address: lead.address || "",
    rating: lead.rating != null ? String(lead.rating) : "",
    website: lead.website || "",
    phone: lead.phone || "",
    business_type: lead.query || "",
    category: lead.query || "",
    // A rival from the same search that already has a website
    competitor: competitor || DEFAULT_COMPETITOR,
    // The sender
    sender: settings?.userName || "",
    myname: settings?.userName || "",
    agency: settings?.userBusiness || "",
    mybusiness: settings?.userBusiness || "",
    profession: settings?.userProfession || "",
    link: settings?.portfolioLink || "",
    portfolio: settings?.portfolioLink || "",
  };
  return body.replace(/{{\s*(\w+)\s*}}/g, (_m, key: string) => {
    const v = map[key.toLowerCase()];
    return v !== undefined ? v : `{{${key}}}`;
  });
}

// Sleep that wakes early if a stop is requested.
async function interruptibleSleep(ms: number, shouldStop: () => boolean) {
  const step = 500;
  let waited = 0;
  while (waited < ms) {
    if (shouldStop()) return;
    await new Promise((r) => setTimeout(r, Math.min(step, ms - waited)));
    waited += step;
  }
}

export type StartCampaignOpts = {
  leadIds: string[];
  templateBody: string;
  fallbackLocation?: string;
  mediaPath?: string | null;
};

export async function startCampaign(
  userId: string,
  opts: StartCampaignOpts
): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = campaigns.get(userId);
  if (existing?.running) {
    return { ok: false, error: "A send campaign is already running." };
  }

  const { status } = getWhatsAppStatus(userId);
  const client = getClient(userId);
  if (!client || status !== "READY") {
    return { ok: false, error: "WhatsApp is not connected. Scan the QR first." };
  }

  const settings = await prisma.settings.findUnique({ where: { userId } });
  const cfg = {
    dailyCap: settings?.dailyCap ?? DEFAULTS.dailyCap,
    minDelaySec: settings?.minDelaySec ?? DEFAULTS.minDelaySec,
    maxDelaySec: settings?.maxDelaySec ?? DEFAULTS.maxDelaySec,
    batchSize: settings?.batchSize ?? DEFAULTS.batchSize,
    batchPauseSec: settings?.batchPauseSec ?? DEFAULTS.batchPauseSec,
    warmup: settings?.warmup ?? DEFAULTS.warmup,
    validateNumbers: settings?.validateNumbers ?? DEFAULTS.validateNumbers,
  };
  if (cfg.maxDelaySec < cfg.minDelaySec) cfg.maxDelaySec = cfg.minDelaySec;

  // Load leads, preserving the caller's order, only this user's.
  const leads = await prisma.lead.findMany({
    where: { id: { in: opts.leadIds }, userId },
  });
  const byId = new Map(leads.map((l) => [l.id, l]));
  const ordered = opts.leadIds.map((id) => byId.get(id)).filter(Boolean) as Lead[];

  // How many we've already sent today counts against the cap.
  const dailySentToday = await prisma.messageLog.count({
    where: { userId, status: "SENT", createdAt: { gte: startOfToday() } },
  });

  const state: CampaignState = {
    running: true,
    total: ordered.length,
    sent: 0,
    failed: 0,
    invalid: 0,
    skipped: 0,
    processed: 0,
    startedAt: Date.now(),
    stopRequested: false,
    dailyCap: cfg.dailyCap,
    dailySentToday,
    items: ordered.map((l) => ({
      leadId: l.id,
      name: l.name,
      phone: l.phone,
      status: "PENDING" as const,
    })),
  };
  campaigns.set(userId, state);

  // Optional shared media (portfolio / brochure) — same for every lead.
  let media: MessageMedia | null = null;
  if (opts.mediaPath) {
    try {
      media = MessageMedia.fromFilePath(opts.mediaPath);
    } catch (e) {
      console.error("Failed to load media for campaign", e);
    }
  }

  // Resolve {{competitor}} once up front — it only depends on saved leads.
  const competitors = /{{\s*competitor\s*}}/i.test(opts.templateBody)
    ? await buildCompetitorMap(userId, ordered)
    : new Map<string, string>();

  // Fire-and-forget runner.
  void runCampaign(userId, state, ordered, opts, cfg, media, settings, competitors).catch((e) => {
    console.error("Campaign crashed", e);
    state.running = false;
    state.finishedAt = Date.now();
    state.stopReason = "ERROR";
  });

  return { ok: true };
}

async function runCampaign(
  userId: string,
  state: CampaignState,
  leads: Lead[],
  opts: StartCampaignOpts,
  cfg: {
    dailyCap: number;
    minDelaySec: number;
    maxDelaySec: number;
    batchSize: number;
    batchPauseSec: number;
    warmup: boolean;
    validateNumbers: boolean;
  },
  media: MessageMedia | null,
  settings: Settings | null,
  competitors: Map<string, string>
) {
  const client = getClient(userId);
  if (!client) {
    state.running = false;
    state.finishedAt = Date.now();
    state.stopReason = "WA_DISCONNECTED";
    return;
  }

  let consecutiveFailures = 0;
  let sentInSession = 0;

  const log = (leadId: string | null, phone: string, status: string, error?: string) =>
    prisma.messageLog
      .create({ data: { userId, leadId, phone, status, error: error?.slice(0, 300) } })
      .catch(() => {});

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    const item = state.items[i];
    state.currentName = lead.name;

    if (state.stopRequested) {
      state.stopReason = "STOPPED";
      break;
    }

    // Daily cap guard (counts prior sends today + this session).
    if (state.dailySentToday >= cfg.dailyCap) {
      state.stopReason = "DAILY_CAP";
      break;
    }

    const digits = normalizePhone(lead.phone);
    if (!isPlausibleNumber(digits)) {
      item.status = "INVALID";
      item.error = "Invalid phone";
      state.invalid++;
      state.processed++;
      await prisma.lead
        .updateMany({ where: { id: lead.id, userId }, data: { status: "INVALID", lastError: "Invalid phone" } })
        .catch(() => {});
      await log(lead.id, digits, "INVALID", "Invalid phone");
      continue;
    }

    const chatId = `${digits}@c.us`;

    // Skip numbers that aren't actually on WhatsApp — sending to dead numbers
    // is a strong ban signal.
    if (cfg.validateNumbers) {
      try {
        let numberId = await client.getNumberId(digits);
        if (!numberId) {
          numberId = await client.getNumberId(`${digits}@c.us`);
        }
        let isRegistered = Boolean(numberId);
        if (!isRegistered && typeof (client as any).isRegisteredUser === "function") {
          try {
            isRegistered = await (client as any).isRegisteredUser(`${digits}@c.us`);
          } catch {}
        }
        if (!isRegistered) {
          const isStandardIndianMobile = /^91[6789]\d{9}$/.test(digits);
          if (!isStandardIndianMobile) {
            item.status = "INVALID";
            item.error = "Not on WhatsApp";
            state.invalid++;
            state.processed++;
            await prisma.lead
              .updateMany({ where: { id: lead.id, userId }, data: { status: "INVALID", lastError: "Not on WhatsApp" } })
              .catch(() => {});
            await log(lead.id, digits, "INVALID", "Not on WhatsApp");
            continue;
          }
        }
      } catch (e) {
        // If the check itself fails, fall through and attempt the send.
        console.warn("Number validation check failed", e);
      }
    }

    const message = renderTemplate(
      opts.templateBody,
      lead,
      settings,
      opts.fallbackLocation,
      competitors.get(lead.id)
    );

    try {
      if (media) {
        await client.sendMessage(chatId, media, { caption: message });
      } else {
        await client.sendMessage(chatId, message);
      }

      item.status = "SENT";
      item.at = Date.now();
      state.sent++;
      state.dailySentToday++;
      sentInSession++;
      consecutiveFailures = 0;
      await prisma.lead
        .updateMany({
          where: { id: lead.id, userId },
          data: { status: "SENT", lastContactedAt: new Date(), lastError: null },
        })
        .catch(() => {});
      await log(lead.id, digits, "SENT");
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : "Send failed";
      item.status = "FAILED";
      item.error = err;
      state.failed++;
      consecutiveFailures++;
      await prisma.lead
        .updateMany({ where: { id: lead.id, userId }, data: { status: "FAILED", lastError: err.slice(0, 300) } })
        .catch(() => {});
      await log(lead.id, digits, "FAILED", err);
    }

    state.processed++;

    // Too many failures in a row usually means the number is blocked/banned —
    // stop immediately to limit the damage.
    if (consecutiveFailures >= 5) {
      state.stopReason = "TOO_MANY_FAILURES";
      break;
    }

    // Nothing left to wait for after the final message.
    if (i === leads.length - 1) break;
    if (state.dailySentToday >= cfg.dailyCap) {
      state.stopReason = "DAILY_CAP";
      break;
    }

    // Randomised human-like gap.
    let delayMs = rand(cfg.minDelaySec, cfg.maxDelaySec) * 1000;
    // Warm-up: go slower for the first few messages of the session.
    if (cfg.warmup && sentInSession < 5) delayMs = Math.round(delayMs * 1.8);
    // Longer cool-down after each batch.
    if (sentInSession > 0 && sentInSession % cfg.batchSize === 0) {
      delayMs += cfg.batchPauseSec * 1000;
    }

    state.nextSendAt = Date.now() + delayMs;
    await interruptibleSleep(delayMs, () => state.stopRequested);
  }

  state.running = false;
  state.finishedAt = Date.now();
  state.nextSendAt = undefined;
  if (!state.stopReason) state.stopReason = "DONE";
}

// Shared single-send used by /api/send. Applies the daily cap + logging so the
// one-off path can't be used to bypass anti-ban limits.
export async function sendSingle(
  userId: string,
  leadId: string | undefined,
  phone: string,
  message: string
): Promise<{ ok: true; id: string } | { ok: false; error: string; code?: string }> {
  const { status } = getWhatsAppStatus(userId);
  const client = getClient(userId);
  if (!client || status !== "READY") {
    return { ok: false, error: "WhatsApp Client is not ready. Please scan QR code first." };
  }

  const settings = await prisma.settings.findUnique({ where: { userId } });
  const cap = settings?.dailyCap ?? DEFAULTS.dailyCap;
  const sentToday = await prisma.messageLog.count({
    where: { userId, status: "SENT", createdAt: { gte: startOfToday() } },
  });
  if (sentToday >= cap) {
    return { ok: false, error: `Daily send limit reached (${cap}). Try again tomorrow.`, code: "DAILY_CAP" };
  }

  const digits = normalizePhone(phone);
  if (!isPlausibleNumber(digits)) {
    return { ok: false, error: "Invalid phone number." };
  }
  const chatId = `${digits}@c.us`;

  try {
    const res = await client.sendMessage(chatId, message);
    if (leadId) {
      await prisma.lead
        .updateMany({
          where: { id: leadId, userId },
          data: { status: "SENT", lastContactedAt: new Date(), lastError: null },
        })
        .catch(() => {});
    }
    await prisma.messageLog.create({ data: { userId, leadId: leadId ?? null, phone: digits, status: "SENT" } }).catch(() => {});
    return { ok: true, id: res.id._serialized };
  } catch (e: unknown) {
    const err = e instanceof Error ? e.message : "Send failed";
    if (leadId) {
      await prisma.lead
        .updateMany({ where: { id: leadId, userId }, data: { status: "FAILED", lastError: err.slice(0, 300) } })
        .catch(() => {});
    }
    await prisma.messageLog.create({ data: { userId, leadId: leadId ?? null, phone: digits, status: "FAILED", error: err.slice(0, 300) } }).catch(() => {});
    return { ok: false, error: err };
  }
}
