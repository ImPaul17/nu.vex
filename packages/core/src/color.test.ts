import assert from 'node:assert/strict';
import test from 'node:test';
import { accentForeground } from './color.js';

test('accent foreground handles dark, light and the official mint accent', () => {
  assert.equal(accentForeground('#000000'), '#ffffff');
  assert.equal(accentForeground('#0B2E26'), '#ffffff');
  assert.equal(accentForeground('#FFFFFF'), '#000000');
  assert.equal(accentForeground('#14D392'), '#000000');
  assert.equal(accentForeground('#7EE6C0'), '#000000');
});

test('accent foreground switches around the middle-gray contrast boundary', () => {
  assert.equal(accentForeground('#757575'), '#ffffff');
  assert.equal(accentForeground('#767676'), '#000000');
});

test('every 8-bit gray background gets at least WCAG AA normal-text contrast', () => {
  for (let gray = 0; gray <= 255; gray += 1) {
    const hex = `#${gray.toString(16).padStart(2, '0').repeat(3)}`;
    // For neutral grays, relative luminance is the single linearized channel.
    const srgb = gray / 255;
    const luminance = srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    const foreground = accentForeground(hex);
    const contrast = foreground === '#000000' ? (luminance + 0.05) / 0.05 : 1.05 / (luminance + 0.05);
    assert.ok(contrast >= 4.5, `${hex} with ${foreground} has contrast ${contrast}`);
  }
});

test('accent foreground accepts only exact six-digit hex colors', () => {
  for (const invalid of ['black', '#fff', '#ffffff00', '#fffffg', ' #ffffff', '#000000;display:none', '#000000\n']) {
    assert.throws(() => accentForeground(invalid));
  }
});
