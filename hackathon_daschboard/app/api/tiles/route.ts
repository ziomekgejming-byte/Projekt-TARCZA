import { NextRequest, NextResponse } from 'next/server';

// Strict allowed hostnames
const ALLOWED_HOSTS = new Set([
  'mapy.geoportal.gov.pl',
  'integracja.gugik.gov.pl',
  'wody.isok.gov.pl',
  'tile.openstreetmap.org',
  'a.tile.openstreetmap.org',
  'b.tile.openstreetmap.org',
  'c.tile.openstreetmap.org',
]);

const MAX_RESPONSE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB max tile/image size

// Simple in-memory sliding rate limiter per client IP
const clientRequestCounts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 180; // 180 tiles/min per IP

export async function GET(req: NextRequest) {
  const urlParam = req.nextUrl.searchParams.get('url');
  if (!urlParam) {
    return new NextResponse('Missing url parameter', { status: 400 });
  }

  // 1. Session verification & origin validation
  const sessionCookie = req.cookies.get('tarcza_session');
  const referer = req.headers.get('referer') || '';
  const isDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false';
  
  // Allow if has valid session cookie or request originates from same app host or in demo mode
  const hasValidAuth = Boolean(sessionCookie?.value) || isDemoMode || referer.includes(req.nextUrl.host);
  if (!hasValidAuth) {
    return new NextResponse('Unauthorized tile proxy access. Session required.', { status: 401 });
  }

  // 2. Rate limiting check
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'internal-client';
  const now = Date.now();
  const rateRecord = clientRequestCounts.get(clientIp);

  if (rateRecord && rateRecord.resetAt > now) {
    if (rateRecord.count >= RATE_LIMIT_MAX_REQUESTS) {
      return new NextResponse('Rate limit exceeded for tile proxy. Retry in a moment.', {
        status: 429,
        headers: { 'Retry-After': '10' },
      });
    }
    rateRecord.count += 1;
  } else {
    clientRequestCounts.set(clientIp, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
  }

  try {
    const targetUrl = new URL(urlParam);

    // 3. Exact protocol check - HTTPS only
    if (targetUrl.protocol !== 'https:') {
      return new NextResponse('Only secure HTTPS tile endpoints are permitted', { status: 400 });
    }

    // 4. Exact hostname check
    if (!ALLOWED_HOSTS.has(targetUrl.hostname)) {
      return new NextResponse(`Host '${targetUrl.hostname}' is not in authorized tile whitelist`, { status: 403 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const response = await fetch(targetUrl.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'TARCZA-Rescue-GIS/3.5 (Dual-Use Rescue Response)',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
      next: { revalidate: 86400 },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return new NextResponse(`Tile upstream error: ${response.status}`, { status: response.status });
    }

    // 5. Response size & content type limits
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE_BYTES) {
      return new NextResponse('Tile payload exceeds allowed maximum size (5MB)', { status: 413 });
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const buffer = await response.arrayBuffer();

    if (buffer.byteLength > MAX_RESPONSE_SIZE_BYTES) {
      return new NextResponse('Tile payload exceeds allowed maximum size (5MB)', { status: 413 });
    }

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=43200',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Tile proxy error:', error);
    return new NextResponse('Error fetching tile from upstream service', { status: 502 });
  }
}

