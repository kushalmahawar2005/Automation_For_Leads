import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser, markUserOnboarded } from '@/lib/auth';

export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const settings = await prisma.settings.findUnique({ where: { userId: user.id } });

  if (!settings?.userName?.trim() || !settings?.userBusiness?.trim()) {
    return NextResponse.json(
      { error: 'Please complete your profile (name and business) before finishing.' },
      { status: 400 }
    );
  }

  if (!settings?.serpApiKey?.trim()) {
    return NextResponse.json(
      { error: 'SerpAPI key is required to finish onboarding.' },
      { status: 400 }
    );
  }

  await markUserOnboarded(user.id);
  return NextResponse.json({ ok: true });
}
