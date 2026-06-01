import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PAGES = new Set(['/login', '/register', '/verify']);
const PUBLIC_API_PREFIXES = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/verify',
  '/api/auth/resend',
];
const ONBOARDING_PAGE = '/onboarding';
const ONBOARDING_API_PREFIX = '/api/onboarding';

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = !!req.cookies.get('session')?.value;
  const isOnboarded = req.cookies.get('onboarded')?.value === '1';

  const isPublicPage = PUBLIC_PAGES.has(pathname);
  const isPublicApi = PUBLIC_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
  const isOnboardingPage = pathname === ONBOARDING_PAGE;
  const isApi = pathname.startsWith('/api/');
  const isOnboardingApi = pathname.startsWith(ONBOARDING_API_PREFIX);

  if (hasSession && isPublicPage) {
    return NextResponse.redirect(new URL(isOnboarded ? '/' : ONBOARDING_PAGE, req.nextUrl));
  }

  if (!hasSession && !isPublicPage && !isPublicApi) {
    if (isApi) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', req.nextUrl));
  }

  if (hasSession && !isOnboarded && !isOnboardingPage && !isApi) {
    return NextResponse.redirect(new URL(ONBOARDING_PAGE, req.nextUrl));
  }

  if (hasSession && isOnboarded && isOnboardingPage) {
    return NextResponse.redirect(new URL('/', req.nextUrl));
  }

  const isAdmin = req.cookies.get('is_admin')?.value === '1';
  const isAdminRoute = pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/api/admin/');
  if (isAdminRoute && !isAdmin) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.redirect(new URL('/', req.nextUrl));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)'],
};
