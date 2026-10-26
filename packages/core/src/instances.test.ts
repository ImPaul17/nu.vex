import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSavedInstances, rememberInstance } from './instances.js';

test('recupera solo orígenes seguros, únicos y sin campos de credenciales', () => {
  const result = parseSavedInstances(JSON.stringify([
    { url: 'https://equipo.example/', name: 'Equipo', token: 'nunca-se-conserva' },
    { url: 'https://equipo.example', name: 'Duplicado' },
    { url: 'http://public.example', name: 'Inseguro' },
    { url: 'https://user:password@private.example', name: 'Credenciales' },
    { url: 'https://path.example/api', name: 'Ruta' },
    { url: 'http://localhost:3001', name: 'Local' },
    null
  ]));
  assert.deepEqual(result, [
    { url: 'https://equipo.example', name: 'Equipo', lastUsedAt: 0 },
    { url: 'http://localhost:3001', name: 'Local', lastUsedAt: 0 }
  ]);
  assert.deepEqual(parseSavedInstances('{'), []);
  assert.deepEqual(parseSavedInstances(' '.repeat(16_385)), []);
});

test('recuerda seis instancias y mueve la elegida al inicio sin duplicarla', () => {
  let list = [] as ReturnType<typeof parseSavedInstances>;
  for (let i = 0; i < 8; i++) list = rememberInstance(list, { url: `https://i${i}.example`, name: `Equipo ${i}` }, i);
  assert.equal(list.length, 6);
  assert.equal(list.at(-1)?.url, 'https://i2.example');
  list = rememberInstance(list, { url: 'https://i2.example/', name: 'Nuevo nombre' }, 20);
  assert.equal(list.length, 6);
  assert.deepEqual(list[0], { url: 'https://i2.example', name: 'Nuevo nombre', lastUsedAt: 20 });
});
