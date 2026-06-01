import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { hashPassword, sendOtp, isValidEmail } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const { email, password, name } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return NextResponse.json({ error: 'Account with this email already exists' }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { email: normalizedEmail, passwordHash, name: name?.trim() || null },
    });

    // No session yet — the account stays unverified until the OTP is confirmed.
    // A send failure shouldn't strand the account; route to verify anyway so the
    // user can retry with "Resend".
    try {
      await sendOtp({ id: user.id, email: user.email });
    } catch (e) {
      console.error('register: failed to send verification email', e);
    }

    return NextResponse.json({ needsVerification: true, email: user.email });
  } catch (e) {
    console.error('register error', e);
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 });
  }
}
