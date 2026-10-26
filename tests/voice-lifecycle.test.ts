import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VoiceSession, type VoiceApi, type VoiceJoin, type VoiceState } from '../apps/web/src/lib/services/voice.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
class MicrophoneTrack extends EventTarget {
  kind = 'audio';
  enabled = true;
  stopped = false;
  stop() { this.stopped = true; }
}
function microphone() {
  const track = new MicrophoneTrack();
  return { track, stream: { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream };
}
const joined: VoiceJoin = {
  channelId: '11111111-1111-4111-8111-111111111111',
  revision: 10,
  participant: { id: '22222222-2222-4222-8222-222222222222', userId: '33333333-3333-4333-8333-333333333333', displayName: 'Prueba', muted: false, deafened: false },
  participants: [], iceServers: [], maxParticipants: 8
};
joined.participants = [joined.participant];

function environment(getUserMedia: () => Promise<MediaStream>) {
  const savedNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const savedPeer = Object.getOwnPropertyDescriptor(globalThis, 'RTCPeerConnection');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia, enumerateDevices: async () => [], addEventListener() {}, removeEventListener() {} } } });
  Object.defineProperty(globalThis, 'RTCPeerConnection', { configurable: true, value: class {} });
  return () => {
    if (savedNavigator) Object.defineProperty(globalThis, 'navigator', savedNavigator); else Reflect.deleteProperty(globalThis, 'navigator');
    if (savedPeer) Object.defineProperty(globalThis, 'RTCPeerConnection', savedPeer); else Reflect.deleteProperty(globalThis, 'RTCPeerConnection');
  };
}

type FakeSender = { track: MediaStreamTrack | null; replaceTrack: (track: MediaStreamTrack | null) => Promise<void> };
function environmentWithPeers(getUserMedia: () => Promise<MediaStream>, replacing: () => Promise<void>) {
  const restoreBase = environment(getUserMedia);
  const savedDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const savedStream = Object.getOwnPropertyDescriptor(globalThis, 'MediaStream');
  const peers: { senders: FakeSender[] }[] = [];
  class Peer {
    connectionState = 'connected';
    signalingState = 'stable';
    senders: FakeSender[] = [];
    constructor() { peers.push(this); }
    addTrack(track: MediaStreamTrack) {
      const sender: FakeSender = { track, async replaceTrack(next) { await replacing(); sender.track = next; } };
      this.senders.push(sender);
    }
    getSenders() { return this.senders; }
    close() { this.connectionState = 'closed'; }
  }
  Object.defineProperty(globalThis, 'RTCPeerConnection', { configurable: true, value: Peer });
  Object.defineProperty(globalThis, 'MediaStream', { configurable: true, value: class {} });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ srcObject: null, pause() {}, remove() {} }) } });
  return {
    peers,
    restore() {
      if (savedDocument) Object.defineProperty(globalThis, 'document', savedDocument); else Reflect.deleteProperty(globalThis, 'document');
      if (savedStream) Object.defineProperty(globalThis, 'MediaStream', savedStream); else Reflect.deleteProperty(globalThis, 'MediaStream');
      restoreBase();
    }
  };
}

const otherParticipant = { ...joined.participant, id: '11111111-1111-4111-8111-111111111111', userId: '44444444-4444-4444-8444-444444444444', displayName: 'Otra persona' };
const roomWithPeer: VoiceJoin = { ...joined, participants: [joined.participant, otherParticipant] };

test('cancelar mientras se autoriza el micrófono detiene una captura que llega tarde y no entra al servidor', async t => {
  const permission = deferred<MediaStream>(); const input = microphone();
  t.after(environment(() => permission.promise));
  const states: VoiceState[] = []; let joins = 0;
  const api: VoiceApi = { async joinVoice() { joins++; return joined; }, async voiceControl() {} };
  const session = new VoiceSession(api, joined.channelId, 'Charla', state => states.push(state));
  const entering = session.join();
  session.leave(); permission.resolve(input.stream); await entering;
  assert.equal(input.track.stopped, true);
  assert.equal(joins, 0);
  assert.equal(states.at(-1)?.status, 'idle');
});

test('salir durante el join HTTP libera el micrófono y abandona el identificador tardío sin resucitar la llamada', async t => {
  const response = deferred<VoiceJoin>(); const requested = deferred<void>(); const input = microphone();
  t.after(environment(async () => input.stream));
  const states: VoiceState[] = []; const left: string[] = [];
  const api: VoiceApi = {
    async joinVoice() { requested.resolve(); return response.promise; },
    async voiceControl(_channel, action, body) { if (action === 'leave') left.push(body.participantId as string); }
  };
  const session = new VoiceSession(api, joined.channelId, 'Charla', state => states.push(state));
  const entering = session.join(); await requested.promise;
  session.leave(); assert.equal(input.track.stopped, true);
  response.resolve(joined); await entering;
  assert.deepEqual(left, [joined.participant.id]);
  assert.equal(states.at(-1)?.status, 'idle');
});

test('dejar de escuchar silencia el envío y conserva la elección previa del micrófono al volver', async t => {
  const input = microphone(); t.after(environment(async () => input.stream));
  const states: VoiceState[] = []; const updates: { muted: unknown; deafened: unknown }[] = [];
  const api: VoiceApi = { async joinVoice() { return joined; }, async voiceControl(_channel, action, body) { if (action === 'state') updates.push({ muted: body.muted, deafened: body.deafened }); } };
  const session = new VoiceSession(api, joined.channelId, 'Charla', state => states.push(state));
  t.after(() => session.leave()); await session.join();
  await session.toggleDeafened(); assert.equal(input.track.enabled, false);
  await session.toggleDeafened(); assert.equal(input.track.enabled, true);
  await session.toggleMuted(); assert.equal(input.track.enabled, false);
  await session.toggleDeafened(); await session.toggleDeafened();
  assert.equal(input.track.enabled, false); assert.equal(states.at(-1)?.muted, true);
  assert.deepEqual(updates.slice(-3), [{ muted: true, deafened: false }, { muted: true, deafened: true }, { muted: true, deafened: false }]);
});

test('una persona que entra durante el cambio de micrófono recibe la pista nueva y no la que se detiene', async t => {
  const input = microphone(); const replacement = microphone();
  const replacing = deferred<void>(); const release = deferred<void>();
  let captures = 0;
  const browser = environmentWithPeers(async () => ++captures === 1 ? input.stream : replacement.stream, async () => { replacing.resolve(); await release.promise; });
  const api: VoiceApi = { async joinVoice() { return roomWithPeer; }, async voiceControl() {} };
  const session = new VoiceSession(api, joined.channelId, 'Charla', () => {});
  t.after(() => { session.leave(); release.resolve(); browser.restore(); });
  await session.join();
  const changing = session.setInput('otro-microfono');
  await replacing.promise;
  session.event({ type: 'voice.participants', channelId: joined.channelId, revision: 11, participants: [...roomWithPeer.participants, { ...otherParticipant, id: '11111111-1111-4111-8111-111111111112' }] });
  release.resolve(); await changing;
  assert.equal(input.track.stopped, true);
  assert.equal(browser.peers.length, 2);
  assert.equal(browser.peers[0].senders[0].track, replacement.track);
  assert.equal(browser.peers[1].senders[0].track, replacement.track);
  assert.equal(replacement.track.stopped, false);
});

test('salir detiene una captura tardía aunque un cambio de micrófono anterior siga bloqueado', async t => {
  const input = microphone(); const first = microphone(); const late = microphone();
  const permission = deferred<MediaStream>(); const replacing = deferred<void>(); const release = deferred<void>();
  let captures = 0;
  const browser = environmentWithPeers(async () => ++captures === 1 ? input.stream : captures === 2 ? first.stream : permission.promise, async () => { replacing.resolve(); await release.promise; });
  const api: VoiceApi = { async joinVoice() { return roomWithPeer; }, async voiceControl() {} };
  const session = new VoiceSession(api, joined.channelId, 'Charla', () => {});
  t.after(() => { session.leave(); release.resolve(); browser.restore(); });
  await session.join();
  const firstChange = session.setInput('primero'); await replacing.promise;
  const lateChange = session.setInput('tardio'); session.leave();
  permission.resolve(late.stream);
  await new Promise<void>(resolve => setImmediate(resolve));
  await new Promise<void>(resolve => setImmediate(resolve));
  // Se comprueba antes de desbloquear replaceTrack: la cola no puede retrasar la privacidad.
  assert.equal(input.track.stopped, true);
  assert.equal(first.track.stopped, true);
  assert.equal(late.track.stopped, true);
  release.resolve(); await Promise.all([firstChange, lateChange]);
});

test('los listados anteriores al alta no expulsan la participación recién confirmada', async t => {
  const permission = deferred<MediaStream>(); const input = microphone();
  const response = deferred<VoiceJoin>(); const requested = deferred<void>();
  const restore = environment(() => permission.promise);
  const states: VoiceState[] = []; const controls: string[] = [];
  const api: VoiceApi = { async joinVoice() { requested.resolve(); return response.promise; }, async voiceControl(_channel, action) { controls.push(action); } };
  const session = new VoiceSession(api, joined.channelId, 'Charla', state => states.push(state));
  t.after(() => { session.leave(); restore(); });
  const entering = session.join();
  session.event({ type: 'voice.participants', channelId: joined.channelId, revision: 8, participants: [] });
  permission.resolve(input.stream); await requested.promise;
  session.event({ type: 'voice.participants', channelId: joined.channelId, revision: 9, participants: [] });
  response.resolve(joined); await entering;
  assert.equal(states.at(-1)?.status, 'connected');
  assert.equal(states.at(-1)?.participantId, joined.participant.id);
  assert.equal(input.track.stopped, false);
  assert.equal(controls.includes('leave'), false);
});

test('un listado atrasado tras el join se ignora pero una retirada con revisión nueva cierra el micrófono', async t => {
  const input = microphone(); const restore = environment(async () => input.stream);
  const states: VoiceState[] = []; const controls: string[] = [];
  const api: VoiceApi = { async joinVoice() { return joined; }, async voiceControl(_channel, action) { controls.push(action); } };
  const session = new VoiceSession(api, joined.channelId, 'Charla', state => states.push(state));
  t.after(() => { session.leave(); restore(); });
  await session.join();
  session.event({ type: 'voice.participants', channelId: joined.channelId, revision: 9, participants: [] });
  session.event({ type: 'voice.participants', channelId: joined.channelId, revision: 10, participants: [] });
  assert.equal(states.at(-1)?.status, 'connected');
  assert.equal(states.at(-1)?.participantId, joined.participant.id);
  assert.equal(input.track.stopped, false);
  assert.equal(controls.includes('leave'), false);

  session.event({ type: 'voice.participants', channelId: joined.channelId, revision: 11, participants: [] });
  assert.equal(states.at(-1)?.status, 'error');
  assert.equal(input.track.stopped, true);
  assert.equal(controls.includes('leave'), true);
});
