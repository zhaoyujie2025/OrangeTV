/* eslint-disable no-console,@typescript-eslint/no-explicit-any */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function buildCorsHeaders(contentType?: string, extra?: Record<string, string>) {
  const headers = new Headers();
  if (contentType) headers.set('Content-Type', contentType);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Range, Origin, Accept');
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
  headers.set('Cache-Control', 'no-cache');
  if (extra) {
    Object.entries(extra).forEach(([k, v]) => headers.set(k, v));
  }
  return headers;
}

async function forwardRequest(url: string, method: 'GET' | 'HEAD', reqHeaders: Headers) {
  const decodedUrl = decodeURIComponent(url);

  // 透传范围请求和必要请求头
  const fetchHeaders: Record<string, string> = {};
  const range = reqHeaders.get('Range');
  if (range) fetchHeaders['Range'] = range;
  const accept = reqHeaders.get('Accept');
  if (accept) fetchHeaders['Accept'] = accept;

  // 统一 UA，部分源（如 quark drive）需要浏览器 UA 才能返回
  fetchHeaders['User-Agent'] =
    reqHeaders.get('User-Agent') ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

  const upstream = await fetch(decodedUrl, {
    method,
    headers: fetchHeaders,
    redirect: 'follow',
    cache: 'no-store',
  });

  return upstream;
}

export async function HEAD(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get('url');
    if (!url) return NextResponse.json({ error: 'Missing url' }, { status: 400 });

    const upstream = await forwardRequest(url, 'HEAD', request.headers);
    const headers = buildCorsHeaders(upstream.headers.get('Content-Type') || undefined, {
      'Accept-Ranges': upstream.headers.get('Accept-Ranges') || 'bytes',
      'Content-Length': upstream.headers.get('Content-Length') || '',
      'Content-Range': upstream.headers.get('Content-Range') || '',
    });
    const status = upstream.status === 206 ? 206 : upstream.status;
    return new Response(null, { status, headers });
  } catch (e) {
    return NextResponse.json({ error: 'Proxy HEAD failed' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get('url');
    if (!url) return NextResponse.json({ error: 'Missing url' }, { status: 400 });

    const upstream = await forwardRequest(url, 'GET', request.headers);
    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json({ error: `Upstream error ${upstream.status}` }, { status: upstream.status });
    }

    const contentType = upstream.headers.get('Content-Type') || 'application/octet-stream';
    const extra: Record<string, string> = {
      'Accept-Ranges': upstream.headers.get('Accept-Ranges') || 'bytes',
    };
    const contentLength = upstream.headers.get('Content-Length');
    if (contentLength) extra['Content-Length'] = contentLength;
    const contentRange = upstream.headers.get('Content-Range');
    if (contentRange) extra['Content-Range'] = contentRange;

    const headers = buildCorsHeaders(contentType, extra);
    const status = upstream.status === 206 ? 206 : 200;
    return new Response(upstream.body, { status, headers });
  } catch (e) {
    console.error('Proxy video failed:', e);
    return NextResponse.json({ error: 'Proxy failed' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: buildCorsHeaders() });
}


