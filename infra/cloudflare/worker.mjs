const API_ORIGIN = 'http://127.0.0.1:3003';

function unavailable(message) {
  return new Response(JSON.stringify({ error: { code: 'service_unavailable', message } }), {
    status: 503,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function apiPath(pathname) {
  return pathname.startsWith('/api/v1/') || pathname === '/health/live' || pathname === '/health/ready';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!apiPath(url.pathname)) {
      if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') {
        return unavailable('El cliente web no está disponible. Inténtalo de nuevo más tarde.');
      }
      return env.ASSETS.fetch(request);
    }

    const api = env.NUVEX_API;
    if (!api || typeof api.fetch !== 'function') {
      return unavailable('La instancia de nu.vex no está disponible. Inténtalo de nuevo más tarde.');
    }

    const destination = new URL(API_ORIGIN);
    destination.pathname = url.pathname;
    destination.search = url.search;
    const headers = new Headers(request.headers);
    // Origin y credenciales se conservan para que Axum aplique su política exacta.
    // La IP aportada por el cliente nunca se convierte en una IP de proxy fiable.
    headers.delete('Host');
    headers.delete('X-Forwarded-For');
    headers.delete('X-Real-IP');
    const clientAddress = request.headers.get('CF-Connecting-IP');
    if (clientAddress) headers.set('X-Real-IP', clientAddress);

    try {
      const upstream = new Request(destination, {
        method: request.method,
        headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
        redirect: 'manual',
        signal: request.signal,
        duplex: 'half'
      });
      // Devolver la respuesta sin reconstruirla conserva el WebSocket de un 101.
      return await api.fetch(upstream);
    } catch {
      return unavailable('La instancia de nu.vex no está disponible. Inténtalo de nuevo más tarde.');
    }
  }
};
