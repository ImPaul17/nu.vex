import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from './worker.mjs';

test('conserva un Origin ajeno, vacío o duplicado para que el backend lo rechace', async () => {
  for (const origin of ['https://no-autorizado.example', '', 'https://uno.example, https://dos.example', 'null']) {
    let received;
    const response = await worker.fetch(new Request('https://nuvex.example/api/v1/auth/login', {
      method: 'POST', headers: { Origin: origin }, body: '{}'
    }), { NUVEX_API: { fetch(request) { received = request; return new Response('rechazado', { status: 403 }); } } });
    assert.equal(received.headers.get('Origin'), origin);
    assert.equal(response.status, 403);
  }
});

test('envía cuerpo y credenciales al único destino fijo, con la IP suministrada por Cloudflare', async () => {
  let received;
  const body = '{"content":"mensaje de prueba","clientId":"id-sintético"}';
  const request = new Request('https://nuvex.example/api/v1/channels/canal/messages?limit=100', {
    method: 'POST', body,
    headers: {
      Host: 'otro-destino.example',
      Origin: 'https://nuvex.example',
      Cookie: 'nuvex_session=cookie-sintética',
      Authorization: 'Bearer token-sintético',
      'Content-Type': 'application/json',
      'X-Forwarded-For': '198.51.100.99',
      'X-Real-IP': '198.51.100.98',
      'CF-Connecting-IP': '2001:db8::1'
    }
  });
  const expectedResponse = new Response('creado', { status: 201 });
  const result = await worker.fetch(request, { NUVEX_API: { fetch(upstream) { received = upstream; return expectedResponse; } } });
  assert.equal(received.url, 'http://127.0.0.1:3003/api/v1/channels/canal/messages?limit=100');
  assert.equal(received.method, 'POST');
  assert.equal(await received.text(), body);
  assert.equal(received.headers.get('Origin'), 'https://nuvex.example');
  assert.equal(received.headers.get('Cookie'), 'nuvex_session=cookie-sintética');
  assert.equal(received.headers.get('Authorization'), 'Bearer token-sintético');
  assert.equal(received.headers.get('Content-Type'), 'application/json');
  assert.equal(received.headers.get('Host'), null);
  assert.equal(received.headers.get('X-Forwarded-For'), null);
  assert.equal(received.headers.get('X-Real-IP'), '2001:db8::1');
  assert.strictEqual(result, expectedResponse);
});

test('elimina las cabeceras de IP del cliente si no hay dirección de Cloudflare y no inventa Origin', async () => {
  let received;
  await worker.fetch(new Request('https://nuvex.example/health/ready', {
    headers: { 'X-Real-IP': '198.51.100.98', 'X-Forwarded-For': '198.51.100.99' }
  }), { NUVEX_API: { fetch(request) { received = request; return new Response('listo'); } } });
  assert.equal(received.url, 'http://127.0.0.1:3003/health/ready');
  assert.equal(received.headers.get('X-Real-IP'), null);
  assert.equal(received.headers.get('X-Forwarded-For'), null);
  assert.equal(received.headers.has('Origin'), false);
});

test('no sigue redirecciones que pudieran trasladar credenciales a otro destino', async () => {
  let received;
  const redirect = new Response(null, { status: 302, headers: { Location: 'https://otro.example/' } });
  const result = await worker.fetch(new Request('https://nuvex.example/api/v1/instance'), {
    NUVEX_API: { fetch(request) { received = request; return redirect; } }
  });
  assert.equal(received.redirect, 'manual');
  assert.strictEqual(result, redirect);
});

test('las rutas ajenas a la API y la salud exacta se sirven mediante ASSETS', async () => {
  for (const pathname of ['/demo', '/_app/immutable/app.js', '/api/v2/instance', '/api/v1-inventada', '/health/ready/otra']) {
    const request = new Request('https://nuvex.example' + pathname);
    const asset = new Response('cliente');
    let assetRequest;
    const result = await worker.fetch(request, {
      ASSETS: { fetch(input) { assetRequest = input; return asset; } },
      NUVEX_API: { fetch() { assert.fail('Una ruta de cliente no debe consultar el servidor.'); } }
    });
    assert.strictEqual(assetRequest, request);
    assert.strictEqual(result, asset);
  }
});

test('la ausencia del binding de API devuelve un 503 JSON seguro y no almacenable', async () => {
  const response = await worker.fetch(new Request('https://nuvex.example/api/v1/instance'), {});
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.match(response.headers.get('Content-Type'), /^application\/json/);
  assert.deepEqual(await response.json(), {
    error: { code: 'service_unavailable', message: 'La instancia de nu.vex no está disponible. Inténtalo de nuevo más tarde.' }
  });
});

test('un error de red no filtra información interna del servicio', async () => {
  const response = await worker.fetch(new Request('https://nuvex.example/health/live'), {
    NUVEX_API: { fetch() { throw new Error('detalles internos y credenciales sintéticas que no se deben publicar'); } }
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const text = await response.text();
  assert.doesNotMatch(text, /detalles internos|credenciales|stack/);
});

test('la respuesta de actualización WebSocket se devuelve intacta', async () => {
  const websocketResponse = { status: 101, webSocket: { id: 'socket-sintético' } };
  let received;
  const result = await worker.fetch(new Request('https://nuvex.example/api/v1/events?ticket=ticket-sintético', {
    headers: { Upgrade: 'websocket', Connection: 'Upgrade' }
  }), { NUVEX_API: { fetch(request) { received = request; return websocketResponse; } } });
  assert.equal(received.headers.get('Upgrade'), 'websocket');
  assert.equal(received.redirect, 'manual');
  assert.strictEqual(result, websocketResponse);
});
