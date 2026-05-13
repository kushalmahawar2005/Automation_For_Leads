import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyPassword, createSession } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!user) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    await createSession(user.id);

    return NextResponse.json({ id: user.id, email: user.email, name: user.name });
  } catch (e) {
    console.error('login error', e);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
