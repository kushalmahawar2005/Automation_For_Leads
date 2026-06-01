import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { sendOtp } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const { email } = await req.json();
    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });

    // Don't leak which emails exist or whether they're verified — always 200.
    if (!user || user.emailVerified) {
      return NextResponse.json({ ok: true });
    }

    const result = await sendOtp({ id: user.id, email: user.email });
    if ('cooldown' in result) {
      return NextResponse.json(
        { error: `Please wait ${result.cooldown}s before requesting another code.`, cooldown: result.cooldown },
        { status: 429 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('resend error', e);
    return NextResponse.json({ error: 'Could not resend code' }, { status: 500 });
  }
}
