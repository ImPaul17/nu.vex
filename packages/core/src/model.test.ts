import assert from 'node:assert/strict';
import test from 'node:test';
import { demoCommunities, demoMembers, demoMessages } from './demo.js';
import { createLocalMessage, MAX_MESSAGE_LENGTH, validateMessageContent } from './model.js';

test('message content trims outer whitespace, preserves text, and rejects empty messages', () => {
  assert.equal(validateMessageContent('  Hola\n  equipo  '), 'Hola\n  equipo');
  assert.equal(validateMessageContent('<script>alert(1)</script>'), '<script>alert(1)</script>');
  for (const value of ['', ' \t\n ', null, 42, {}]) assert.throws(() => validateMessageContent(value));
});

test('message content enforces the documented length boundary', () => {
  assert.equal(validateMessageContent('a'.repeat(MAX_MESSAGE_LENGTH)).length, MAX_MESSAGE_LENGTH);
  assert.throws(() => validateMessageContent('a'.repeat(MAX_MESSAGE_LENGTH + 1)));
});

test('local messages have stable channel, author, trimmed content and ISO timestamp', () => {
  const message = createLocalMessage('general', 'you', ' Hola ', { id: 'test-1', now: new Date('2026-10-19T08:00:00Z') });
  assert.deepEqual(message, { id: 'test-1', channelId: 'general', authorId: 'you', content: 'Hola', createdAt: '2026-10-19T08:00:00.000Z' });
  assert.throws(() => createLocalMessage('', 'you', 'Hola'));
  assert.throws(() => createLocalMessage('general', ' ', 'Hola'));
  assert.throws(() => createLocalMessage('general', 'you', 'Hola', { now: new Date('invalid') }));
});

test('demo seed references existing members and channels with unique IDs', () => {
  const channels = demoCommunities.flatMap((community) => community.channels);
  const channelIds = new Set(channels.map((channel) => channel.id));
  const memberIds = new Set(demoMembers.map((member) => member.id));
  assert.equal(channelIds.size, channels.length);
  assert.equal(new Set(demoMessages.map((message) => message.id)).size, demoMessages.length);
  assert.ok(demoCommunities.some((community) => community.id === 'nuvex'));
  assert.ok(memberIds.has('you'));
  for (const message of demoMessages) {
    assert.ok(channelIds.has(message.channelId));
    assert.ok(memberIds.has(message.authorId));
    assert.equal(validateMessageContent(message.content), message.content);
    assert.ok(Number.isFinite(Date.parse(message.createdAt)));
  }
});
