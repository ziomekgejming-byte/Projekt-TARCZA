import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const urlParam = req.nextUrl.searchParams.get('url');
  if (!urlParam) {
    return new NextResponse('Missing url parameter', { status: 400 });
  }

  try {
    const targetUrl = new URL(urlParam);
    // Allow proxying only known GIS/Geoportal & tile hosts
    const allowedHosts = [
      'mapy.geoportal.gov.pl',
      'integracja.gugik.gov.pl',
      'wody.isok.gov.pl',
      'tile.openstreetmap.org',
    ];

    const isAllowed = allowedHosts.some(host => targetUrl.hostname.includes(host));
    if (!isAllowed) {
      return new NextResponse('Host not permitted in tile proxy', { status: 403 });
    }

    const response = await fetch(targetUrl.toString(), {
      headers: {
        'User-Agent': 'TARCZA-Rescue-GIS/3.5 (Dual-Use Rescue Response)',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
      next: { revalidate: 3600 },
    });

    if (!response.ok) {
      return new NextResponse(`Proxy fetch error: ${response.status}`, { status: response.status });
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const buffer = await response.arrayBuffer();

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
    return new NextResponse('Error fetching tile', { status: 502 });
  }
}
