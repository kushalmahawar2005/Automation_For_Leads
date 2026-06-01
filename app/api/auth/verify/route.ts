import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyOtp, createSession } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const { email, code } = await req.json();

    if (!email || !code) {
      return NextResponse.json({ error: 'Email and code are required' }, { status: 400 });
    }

    const normalizedCode = String(code).trim();
    if (!/^\d{6}$/.test(normalizedCode)) {
      return NextResponse.json({ error: 'Enter the 6-digit code' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!user) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    if (user.emailVerified) {
      // Already verified — just log them in.
      await createSession(user.id);
      return NextResponse.json({ id: user.id, email: user.email, name: user.name });
    }

    const result = await verifyOtp(user.id, normalizedCode);
    if (!result.ok) {
      const messages: Record<string, string> = {
        no_code: 'No active code. Please request a new one.',
        expired: 'Code expired. Please request a new one.',
        too_many: 'Too many attempts. Please request a new code.',
        invalid: 'Incorrect code. Please try again.',
      };
      return NextResponse.json({ error: messages[result.reason] }, { status: 400 });
    }

    await createSession(user.id);
    return NextResponse.json({ id: user.id, email: user.email, name: user.name });
  } catch (e) {
    console.error('verify error', e);
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}
