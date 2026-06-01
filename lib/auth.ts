import { randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { cookies } from 'next/headers';
import { prisma } from './db';
import { sendVerificationEmail } from './email';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>;

const SESSION_COOKIE = 'session';
const ONBOARDED_COOKIE = 'onboarded';
const ADMIN_COOKIE = 'is_admin';
const SESSION_DAYS = 30;

// Cookies are marked `Secure` in production by default, but `Secure` cookies are
// rejected by browsers over plain HTTP. When serving over HTTP (e.g. an IP with no
// SSL yet), set COOKIE_SECURE=false so sessions persist. Set it back to true once
// HTTPS is in place.
function cookieSecure(): boolean {
  if (process.env.COOKIE_SECURE !== undefined) {
    return process.env.COOKIE_SECURE === 'true';
  }
  return process.env.NODE_ENV === 'production';
}

function adminEmail(): string | null {
  return process.env.ADMIN_EMAIL?.toLowerCase().trim() || null;
}

export function isAdminEmail(email: string): boolean {
  const a = adminEmail();
  return !!a && email.toLowerCase().trim() === a;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const derived = await scrypt(password, salt, expected.length);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { token, userId, expiresAt } });

  let user = await prisma.user.findUnique({ where: { id: userId } });

  if (user && isAdminEmail(user.email) && user.role !== 'admin') {
    user = await prisma.user.update({ where: { id: user.id }, data: { role: 'admin' } });
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
  cookieStore.set(ONBOARDED_COOKIE, user?.onboardedAt ? '1' : '0', {
    httpOnly: false,
    secure: cookieSecure(),
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
  cookieStore.set(ADMIN_COOKIE, user?.role === 'admin' ? '1' : '0', {
    httpOnly: false,
    secure: cookieSecure(),
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });

  return token;
}

export async function markUserOnboarded(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { onboardedAt: new Date() },
  });
  const cookieStore = await cookies();
  const sessionExpires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  cookieStore.set(ONBOARDED_COOKIE, '1', {
    httpOnly: false,
    secure: cookieSecure(),
    sameSite: 'lax',
    path: '/',
    expires: sessionExpires,
  });
}

export async function getSessionUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  return session.user;
}

export async function destroyCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { token } }).catch(() => {});
  }
  cookieStore.delete(SESSION_COOKIE);
  cookieStore.delete(ONBOARDED_COOKIE);
  cookieStore.delete(ADMIN_COOKIE);
}

export async function requireAdmin() {
  const user = await getSessionUser();
  if (!user || user.role !== 'admin') return null;
  return user;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---- Email verification (6-digit OTP) ----

const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SECONDS = 60;

// Generates a fresh OTP for the user, stores its hash, and emails it.
// Returns { cooldown: seconds } if a code was sent too recently (caller should
// tell the user to wait); otherwise returns { sent: true }.
export async function sendOtp(
  user: { id: string; email: string }
): Promise<{ sent: true } | { cooldown: number }> {
  const existing = await prisma.emailVerification.findUnique({ where: { userId: user.id } });
  if (existing) {
    const elapsed = (Date.now() - existing.lastSentAt.getTime()) / 1000;
    if (elapsed < OTP_RESEND_COOLDOWN_SECONDS) {
      return { cooldown: Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - elapsed) };
    }
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const codeHash = await hashPassword(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
  const now = new Date();

  await prisma.emailVerification.upsert({
    where: { userId: user.id },
    create: { userId: user.id, codeHash, expiresAt, lastSentAt: now, attempts: 0 },
    update: { codeHash, expiresAt, lastSentAt: now, attempts: 0 },
  });

  await sendVerificationEmail(user.email, code);
  return { sent: true };
}

type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'no_code' | 'expired' | 'too_many' | 'invalid' };

// Verifies a submitted OTP for the user. On success the user's email is marked
// verified and the verification record is removed.
export async function verifyOtp(userId: string, code: string): Promise<VerifyResult> {
  const record = await prisma.emailVerification.findUnique({ where: { userId } });
  if (!record) return { ok: false, reason: 'no_code' };

  if (record.expiresAt < new Date()) {
    await prisma.emailVerification.delete({ where: { userId } }).catch(() => {});
    return { ok: false, reason: 'expired' };
  }

  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, reason: 'too_many' };
  }

  const valid = await verifyPassword(code, record.codeHash);
  if (!valid) {
    await prisma.emailVerification.update({
      where: { userId },
      data: { attempts: { increment: 1 } },
    });
    return { ok: false, reason: 'invalid' };
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { emailVerified: new Date() } }),
    prisma.emailVerification.delete({ where: { userId } }),
  ]);

  return { ok: true };
}
