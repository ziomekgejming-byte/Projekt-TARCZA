import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const sessionCookie = req.cookies.get('tarcza_session');

  if (!sessionCookie?.value) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  try {
    const raw = Buffer.from(sessionCookie.value, 'base64url').toString('utf-8');
    const session = JSON.parse(raw);

    if (new Date(session.expiresAt).getTime() < Date.now()) {
      return NextResponse.json({ authenticated: false, error: 'Sesja wygasła' }, { status: 401 });
    }

    return NextResponse.json({
      authenticated: true,
      user: session,
    });
  } catch {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
}
