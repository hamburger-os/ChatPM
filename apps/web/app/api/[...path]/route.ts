import type { NextRequest } from 'next/server';

// The browser always calls /api on its own origin. Only the server knows the API address.
type Context = { params: Promise<{path: string[]}> };
async function proxy(request: NextRequest, {params}: Context): Promise<Response> {
  const upstream = new URL(process.env.API_INTERNAL_URL || 'http://127.0.0.1:3001');
  if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password ||
      upstream.pathname !== '/' || upstream.search || upstream.hash)
    return Response.json({error:'Invalid internal API URL'}, {status:503});

  const {path} = await params;
  const eventStream=request.method==='GET'&&path.length===4&&
    path[0]==='projects'&&path[2]==='messages'&&path[3]==='events';
  const url = new URL('/' + path.map(encodeURIComponent).join('/'), upstream);
  url.search = request.nextUrl.search;
  const headers = new Headers();
  for (const name of ['accept','authorization','content-type','cookie','origin','last-event-id']) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  try {
    const hasBody = !['GET', 'HEAD'].includes(request.method);
    const response = await fetch(url, {
      method: request.method, headers,
      body: hasBody ? Buffer.from(await request.arrayBuffer()) : undefined,
      redirect: 'manual', cache: 'no-store',
      signal: eventStream ? request.signal : AbortSignal.timeout(30000),
    });
    const resultHeaders = new Headers();
    for (const name of ['content-type','cache-control','location','x-accel-buffering']) {
      const value = response.headers.get(name);
      if (value) resultHeaders.set(name, value);
    }
    for (const cookie of response.headers.getSetCookie())
      resultHeaders.append('set-cookie', cookie);
    resultHeaders.set('cache-control', 'no-store');
    return new Response(eventStream ? response.body : await response.arrayBuffer(), {
      status: response.status, headers: resultHeaders,
    });
  } catch {
    return Response.json({error:'API temporarily unavailable'}, {status:502});
  }
}
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
