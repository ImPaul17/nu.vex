import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultTheme, MAX_THEME_JSON_BYTES, parseTheme, serializeTheme, validateTheme } from './themes.js';

test('theme exports round-trip through the versioned data-only format', () => {
  assert.deepEqual(parseTheme(serializeTheme(defaultTheme)), defaultTheme);
  assert.notEqual(validateTheme(defaultTheme), defaultTheme);
  for (const theme of ['emerald', 'midnight', 'light']) {
    assert.equal(validateTheme({ ...defaultTheme, theme }).theme, theme);
  }
});

test('theme ranges accept their endpoints and reject unsafe numeric values', () => {
  assert.equal(validateTheme({ ...defaultTheme, glass: 0, radius: 4 }).glass, 0);
  assert.equal(validateTheme({ ...defaultTheme, glass: 1, radius: 24 }).radius, 24);
  for (const glass of [-0.01, 1.01, Infinity, NaN, '0.5', null]) {
    assert.throws(() => validateTheme({ ...defaultTheme, glass }));
  }
  for (const radius of [3.99, 24.01, Infinity, NaN, '12', null]) {
    assert.throws(() => validateTheme({ ...defaultTheme, radius }));
  }
});

test('theme import rejects CSS injection, unknown fields and unsupported versions', () => {
  for (const accent of ['red', '#fff', '#FFFFFF00', '#ffffff\n', '#ffffff;display:none', 'url(https://example.test)', '<script>']) {
    assert.throws(() => validateTheme({ ...defaultTheme, accent }));
  }
  assert.equal(validateTheme({ ...defaultTheme, accent: '#aBc123' }).accent, '#aBc123');
  assert.throws(() => validateTheme({ ...defaultTheme, css: 'body{}' }));
  assert.throws(() => validateTheme({ ...defaultTheme, version: 2 }));
  assert.throws(() => validateTheme({ ...defaultTheme, theme: 'custom' }));
  assert.throws(() => validateTheme({ ...defaultTheme, density: 'tiny' }));
  const { radius: _radius, ...incomplete } = defaultTheme;
  assert.throws(() => validateTheme(incomplete));
  for (const value of [null, [], 'theme', 1, true]) assert.throws(() => validateTheme(value));
  assert.throws(() => parseTheme('{"__proto__":{"polluted":true}}'));
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('theme import rejects malformed JSON and caps UTF-8 input at 16 KB', () => {
  assert.throws(() => parseTheme('{broken'));
  const valid = JSON.stringify(defaultTheme);
  assert.deepEqual(parseTheme(valid.padEnd(MAX_THEME_JSON_BYTES, ' ')), defaultTheme);
  assert.throws(() => parseTheme(valid.padEnd(MAX_THEME_JSON_BYTES + 1, ' ')), /16 KB/);
  assert.throws(() => parseTheme('🌿'.repeat(MAX_THEME_JSON_BYTES / 4 + 1)), /16 KB/);
});
