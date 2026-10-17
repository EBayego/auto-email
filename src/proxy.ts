import { NextResponse, type NextRequest } from 'next/server';
import { createAuthClient } from '@/modules/auth/client';
import { isAuthConfigured } from '@/modules/auth/config';

function createPrivateResponse(request: NextRequest) {
  const response = NextResponse.next({ request });
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export async function proxy(request: NextRequest) {
  let response = createPrivateResponse(request);

  if (!isAuthConfigured()) return response;

  const client = createAuthClient({
    getAll: () => request.cookies.getAll(),
    setAll: (cookiesToSet, headers) => {
      for (const { name, value } of cookiesToSet) {
        request.cookies.set(name, value);
      }
      const previousCookies = response.cookies.getAll();
      response = createPrivateResponse(request);
      for (const cookie of previousCookies) response.cookies.set(cookie);
      for (const { name, value, options } of cookiesToSet) {
        response.cookies.set(name, value, options);
      }
      for (const [name, value] of Object.entries(headers)) {
        response.headers.set(name, value);
      }
    },
  });

  try {
    await client.auth.getUser();
  } catch {
    // Las páginas y handlers verifican la identidad y fallan sin conceder acceso.
  }

  return response;
}

export const config = {
  matcher: [
    '/app/:path*',
    '/api/:path*',
    '/login',
    '/register',
    '/auth/:path*',
  ],
};
