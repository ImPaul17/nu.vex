export type VoiceParticipant = { id: string; userId: string; displayName: string; muted: boolean; deafened: boolean };
export type VoiceSignal = { type: 'offer' | 'answer'; sdp: string } | { type: 'candidate'; candidate: RTCIceCandidateInit | null };
export type VoiceEvent =
  | { type: 'voice.participants'; channelId: string; revision: number; participants: VoiceParticipant[] }
  | { type: 'voice.signal'; channelId: string; fromId: string; targetId: string; signal: VoiceSignal }
  | { type: 'voice.ended'; channelId: string; participantId: string; reason: string };
export type VoiceJoin = { channelId: string; revision: number; participant: VoiceParticipant; participants: VoiceParticipant[]; iceServers: RTCIceServer[]; maxParticipants: number };
export type VoiceState = {
  status: 'idle' | 'joining' | 'connecting' | 'connected' | 'error'; channelId: string; channelName: string;
  participants: VoiceParticipant[]; participantId: string; muted: boolean; deafened: boolean;
  error: string; playbackBlocked: boolean; inputDevice: string; outputDevice: string; volume: number;
  devices: { id: string; label: string; kind: 'audioinput' | 'audiooutput' }[];
  peerVolumes: Record<string, number>; peerMuted: string[];
};
export type VoiceApi = {
  joinVoice(channelId: string): Promise<VoiceJoin>;
  voiceControl(channelId: string, action: 'state' | 'leave' | 'heartbeat' | 'signal', body: Record<string, unknown>): Promise<void>;
};
export const emptyVoiceState = (): VoiceState => ({ status: 'idle', channelId: '', channelName: '', participants: [], participantId: '', muted: false, deafened: false, error: '', playbackBlocked: false, inputDevice: '', outputDevice: '', volume: 1, devices: [], peerVolumes: {}, peerMuted: [] });

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('La respuesta de voz no es válida.');
  return value as Record<string, unknown>;
}
function bounded(value: unknown, max = 128): string {
  if (typeof value !== 'string' || !value || value.length > max) throw new Error('La respuesta de voz no es válida.');
  return value;
}
function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('La revisión de voz no es válida.');
  return value;
}
function participant(value: unknown): VoiceParticipant {
  const data = record(value);
  if (typeof data.muted !== 'boolean' || typeof data.deafened !== 'boolean') throw new Error('El estado de voz no es válido.');
  return { id: bounded(data.id), userId: bounded(data.userId), displayName: bounded(data.displayName, 80), muted: data.muted, deafened: data.deafened };
}
function participants(value: unknown): VoiceParticipant[] {
  if (!Array.isArray(value) || value.length > 8) throw new Error('La lista de voz no es válida.');
  const result = value.map(participant);
  if (new Set(result.map(item => item.id)).size !== result.length) throw new Error('La lista de voz no es válida.');
  return result;
}
function signal(value: unknown): VoiceSignal {
  const data = record(value);
  if (data.type === 'offer' || data.type === 'answer') return { type: data.type, sdp: bounded(data.sdp, 16_384) };
  if (data.type !== 'candidate') throw new Error('La señal de voz no es válida.');
  if (data.candidate === null) return { type: 'candidate', candidate: null };
  const candidate = record(data.candidate);
  if (typeof candidate.candidate !== 'string' || candidate.candidate.length > 4096) throw new Error('El candidato de voz no es válido.');
  if (candidate.sdpMid !== null && candidate.sdpMid !== undefined && typeof candidate.sdpMid !== 'string') throw new Error('El candidato de voz no es válido.');
  if (candidate.sdpMLineIndex !== null && candidate.sdpMLineIndex !== undefined && (!Number.isInteger(candidate.sdpMLineIndex) || (candidate.sdpMLineIndex as number) < 0)) throw new Error('El candidato de voz no es válido.');
  return { type: 'candidate', candidate: { candidate: candidate.candidate, sdpMid: candidate.sdpMid as string | null | undefined, sdpMLineIndex: candidate.sdpMLineIndex as number | null | undefined } };
}
export function decodeVoiceJoin(value: unknown): VoiceJoin {
  const data = record(value);
  if (!Array.isArray(data.iceServers) || data.iceServers.length > 16) throw new Error('La configuración de voz no es válida.');
  const iceServers = data.iceServers.map(value => {
    const ice = record(value);
    const urls = Array.isArray(ice.urls) ? ice.urls : [ice.urls];
    if (!urls.length || urls.length > 8 || urls.some(url => typeof url !== 'string' || url.length > 2048 || !/^(stun|stuns|turn|turns):[^\s]+$/i.test(url))) throw new Error('El servidor ICE no es válido.');
    if (ice.username !== undefined && typeof ice.username !== 'string' || ice.credential !== undefined && typeof ice.credential !== 'string') throw new Error('El servidor ICE no es válido.');
    return { urls: urls as string[], username: ice.username as string | undefined, credential: ice.credential as string | undefined };
  });
  const own = participant(data.participant); const peers = participants(data.participants);
  if (!peers.some(item => item.id === own.id)) throw new Error('La instancia no ha confirmado tu entrada al canal.');
  return { channelId: bounded(data.channelId), revision: revision(data.revision), participant: own, participants: peers, iceServers, maxParticipants: 8 };
}
export function decodeVoiceEvent(value: unknown): VoiceEvent | null {
  try {
    const data = record(value); const channelId = bounded(data.channelId);
    if (data.type === 'voice.participants') return { type: data.type, channelId, revision: revision(data.revision), participants: participants(data.participants) };
    if (data.type === 'voice.signal') return { type: data.type, channelId, fromId: bounded(data.fromId), targetId: bounded(data.targetId), signal: signal(data.signal) };
    if (data.type === 'voice.ended') return { type: data.type, channelId, participantId: bounded(data.participantId), reason: bounded(data.reason, 80) };
  } catch { return null; }
  return null;
}

type Peer = { pc: RTCPeerConnection; audio: HTMLAudioElement; candidates: (RTCIceCandidateInit | null)[]; serial: Promise<void>; offered: boolean };
const explain = (error: unknown) => error instanceof DOMException && error.name === 'NotAllowedError'
  ? 'No se ha autorizado el micrófono. Puedes habilitarlo en los permisos del navegador y volver a unirte.'
  : error instanceof DOMException && error.name === 'NotFoundError' ? 'No encontramos un micrófono conectado.'
  : error instanceof Error ? error.message : 'No se pudo establecer la voz.';

/** Una sola llamada. El cierre libera el micrófono antes de esperar a la red. */
export class VoiceSession {
  private state: VoiceState;
  private stream: MediaStream | null = null;
  private peers = new Map<string, Peer>();
  private iceServers: RTCIceServer[] = [];
  private pending: VoiceEvent[] = [];
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private closed = false;
  private generation = 0;
  private heartbeatPending = false;
  private signalJobs = 0;
  private stateUpdates: Promise<void> = Promise.resolve();
  private inputUpdates: Promise<void> = Promise.resolve();
  private inputRequest = 0;
  private inputStreams = new Set<MediaStream>();
  private lastRosterRevision = -1;
  private deviceChanged = () => { void this.refreshDevices(); };
  constructor(private api: VoiceApi, channelId: string, channelName: string, private change: (state: VoiceState) => void) {
    this.state = { ...emptyVoiceState(), channelId, channelName, status: 'joining' };
  }
  private emit() { this.change({ ...this.state, participants: this.state.participants.map(item => ({ ...item })), devices: [...this.state.devices], peerVolumes: { ...this.state.peerVolumes }, peerMuted: [...this.state.peerMuted] }); }
  async join(): Promise<void> {
    this.emit();
    const generation = ++this.generation;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') throw new Error('La voz requiere un navegador compatible y una conexión HTTPS.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (this.closed || generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      this.watchInput(stream);
      // Antes de pedir el lease aún no pueden existir señales dirigidas a esta llamada.
      this.pending = [];
      const joined = await this.api.joinVoice(this.state.channelId);
      if (this.closed || generation !== this.generation) { void this.api.voiceControl(joined.channelId, 'leave', { participantId: joined.participant.id }).catch(() => {}); return; }
      if (joined.channelId !== this.state.channelId) { void this.api.voiceControl(joined.channelId, 'leave', { participantId: joined.participant.id }).catch(() => {}); throw new Error('La instancia ha devuelto otro canal de voz.'); }
      this.iceServers = joined.iceServers;
      this.lastRosterRevision = joined.revision;
      this.state.participantId = joined.participant.id; this.state.status = 'connecting';
      this.reconcile(joined.participants);
      const queued = this.pending; this.pending = [];
      for (const event of queued) this.event(event);
      if (this.closed) return;
      this.heartbeat = setInterval(() => {
        if (this.closed || this.heartbeatPending) return;
        this.heartbeatPending = true;
        void this.control('heartbeat', {}).catch(error => this.fail(explain(error))).finally(() => this.heartbeatPending = false);
      }, 10_000);
      navigator.mediaDevices.addEventListener('devicechange', this.deviceChanged);
      await this.refreshDevices();
    } catch (error) { if (!this.closed) this.fail(explain(error)); }
  }
  event(event: VoiceEvent): void {
    if (this.closed || event.channelId !== this.state.channelId) return;
    if (!this.state.participantId) { if (this.pending.length < 64) this.pending.push(event); return; }
    if (event.type === 'voice.ended' && event.participantId === this.state.participantId) { this.fail(event.reason === 'revoked' ? 'Ya no tienes acceso a este canal de voz.' : 'La instancia ha finalizado tu conexión de voz.'); return; }
    if (event.type === 'voice.participants') {
      if (event.revision <= this.lastRosterRevision) return;
      this.reconcile(event.participants);
      this.lastRosterRevision = event.revision;
      return;
    }
    if (event.type !== 'voice.signal' || event.targetId !== this.state.participantId || event.fromId === this.state.participantId) return;
    const peer = this.peers.get(event.fromId);
    if (!peer) return;
    peer.serial = peer.serial.then(async () => {
      if (this.closed || this.peers.get(event.fromId) !== peer) return;
      if (event.signal.type === 'candidate') {
        if (!peer.pc.remoteDescription) { if (peer.candidates.length < 64) peer.candidates.push(event.signal.candidate); return; }
        if (event.signal.candidate) await peer.pc.addIceCandidate(event.signal.candidate);
      } else {
        if (event.signal.type === 'offer' && (this.state.participantId < event.fromId || peer.pc.signalingState !== 'stable')) return;
        if (event.signal.type === 'answer' && peer.pc.signalingState !== 'have-local-offer') return;
        await peer.pc.setRemoteDescription(event.signal);
        for (const candidate of peer.candidates.splice(0)) if (candidate) await peer.pc.addIceCandidate(candidate);
        if (event.signal.type === 'offer') {
          await peer.pc.setLocalDescription(await peer.pc.createAnswer());
          if (peer.pc.localDescription) await this.send(event.fromId, { type: 'answer', sdp: peer.pc.localDescription.sdp });
        }
      }
    }).catch(error => { if (!this.closed && this.peers.get(event.fromId) === peer) this.fail(`No se pudo negociar el audio. ${explain(error)}`); });
  }
  private reconcile(participants: VoiceParticipant[]): void {
    if (!participants.some(item => item.id === this.state.participantId)) { this.fail('Ya no formas parte de este canal de voz.'); return; }
    this.state.participants = participants;
    const remaining = new Set(participants.map(item => item.id));
    for (const [id, peer] of this.peers) if (!remaining.has(id)) { this.closePeer(peer); this.peers.delete(id); }
    for (const member of participants) if (member.id !== this.state.participantId && !this.peers.has(member.id)) this.addPeer(member.id);
    this.updateConnection();
  }
  private addPeer(id: string) {
    if (!this.stream || this.closed) return;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: 'max-bundle' });
    const audio = document.createElement('audio'); audio.autoplay = true; audio.muted = this.state.deafened || this.state.peerMuted.includes(id); audio.volume = this.state.volume * (this.state.peerVolumes[id] ?? 1);
    const peer: Peer = { pc, audio, candidates: [], serial: Promise.resolve(), offered: false };
    this.peers.set(id, peer);
    for (const track of this.stream.getAudioTracks()) pc.addTrack(track, this.stream);
    pc.onicecandidate = event => { if (event.candidate) void this.send(id, { type: 'candidate', candidate: event.candidate.toJSON() }).catch(error => this.fail(explain(error))); };
    pc.ontrack = event => {
      if (this.closed || event.track.kind !== 'audio') { event.track.stop(); return; }
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      void this.applyOutput(audio).then(() => audio.play()).catch(() => { if (!this.closed) { this.state.playbackBlocked = true; this.emit(); } });
    };
    pc.onconnectionstatechange = () => {
      if (this.closed || this.peers.get(id) !== peer) return;
      if (pc.connectionState === 'failed') { this.fail('No se pudo conectar el audio con otra persona. Esta red puede necesitar un servidor TURN configurado por la instancia.'); return; }
      this.updateConnection();
    };
    if (this.state.participantId < id) {
      peer.offered = true;
      peer.serial = peer.serial.then(async () => {
        if (this.closed) return;
        await pc.setLocalDescription(await pc.createOffer());
        if (pc.localDescription) await this.send(id, { type: 'offer', sdp: pc.localDescription.sdp });
      }).catch(error => { if (!this.closed && this.peers.get(id) === peer) this.fail(explain(error)); });
    }
  }
  private updateConnection() {
    if (this.closed) return;
    this.state.status = [...this.peers.values()].every(peer => peer.pc.connectionState === 'connected') ? 'connected' : 'connecting'; this.emit();
  }
  private async send(targetId: string, signal: VoiceSignal) {
    if (this.closed || !this.peers.has(targetId)) return;
    if (this.signalJobs >= 128) throw new Error('Hay demasiadas señales de voz pendientes. Vuelve a unirte.');
    this.signalJobs++;
    try { await this.control('signal', { targetId, signal }); } finally { this.signalJobs--; }
  }
  private control(action: 'state' | 'leave' | 'heartbeat' | 'signal', body: Record<string, unknown>) {
    return this.api.voiceControl(this.state.channelId, action, { participantId: this.state.participantId, ...body });
  }
  private async publishState() {
    this.stream?.getAudioTracks().forEach(track => track.enabled = !this.state.muted && !this.state.deafened);
    for (const stream of this.inputStreams) stream.getAudioTracks().forEach(track => track.enabled = !this.state.muted && !this.state.deafened);
    for (const [id, peer] of this.peers) peer.audio.muted = this.state.deafened || this.state.peerMuted.includes(id);
    this.state.participants = this.state.participants.map(item => item.id === this.state.participantId ? { ...item, muted: this.state.muted || this.state.deafened, deafened: this.state.deafened } : item);
    this.emit();
    const update = { muted: this.state.muted || this.state.deafened, deafened: this.state.deafened };
    this.stateUpdates = this.stateUpdates.then(async () => { if (!this.closed) await this.control('state', update); }).catch(error => { if (!this.closed) this.fail(explain(error)); });
    await this.stateUpdates;
  }
  async toggleMuted() { if (this.closed) return; this.state.muted = !this.state.muted; await this.publishState(); }
  async toggleDeafened() { if (this.closed) return; this.state.deafened = !this.state.deafened; await this.publishState(); }
  setVolume(volume: number) { if (!Number.isFinite(volume)) return; this.state.volume = Math.max(0, Math.min(1, volume)); for (const [id, peer] of this.peers) peer.audio.volume = this.state.volume * (this.state.peerVolumes[id] ?? 1); this.emit(); }
  setPeerVolume(id: string, volume: number) { if (this.closed || !this.peers.has(id) || !Number.isFinite(volume)) return; this.state.peerVolumes[id] = Math.max(0, Math.min(1, volume)); this.peers.get(id)!.audio.volume = this.state.volume * this.state.peerVolumes[id]; this.emit(); }
  togglePeerMuted(id: string) { if (this.closed || !this.peers.has(id)) return; this.state.peerMuted = this.state.peerMuted.includes(id) ? this.state.peerMuted.filter(item => item !== id) : [...this.state.peerMuted, id]; this.peers.get(id)!.audio.muted = this.state.deafened || this.state.peerMuted.includes(id); this.emit(); }
  async refreshDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (this.closed) return;
      this.state.devices = devices.filter(item => item.kind === 'audioinput' || item.kind === 'audiooutput').map((item, index) => ({ id: item.deviceId, label: item.label || `Dispositivo ${index + 1}`, kind: item.kind as 'audioinput' | 'audiooutput' }));
      this.emit();
    } catch { /* Una lista de dispositivos no disponible no interrumpe el audio activo. */ }
  }
  async setInput(deviceId: string) {
    if (this.closed) return;
    const generation = this.generation;
    const request = ++this.inputRequest;
    let next: MediaStream | undefined;
    try {
      next = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      const replacement = next;
      if (this.closed || generation !== this.generation || request !== this.inputRequest) { replacement.getTracks().forEach(track => track.stop()); return; }
      this.inputStreams.add(replacement);
      this.inputUpdates = this.inputUpdates.then(async () => {
        if (this.closed || generation !== this.generation || request !== this.inputRequest) { replacement.getTracks().forEach(track => track.stop()); return; }
        const track = replacement.getAudioTracks()[0]; track.enabled = !this.state.muted && !this.state.deafened;
        // Los peers que entren durante replaceTrack ya toman el micrófono nuevo.
        const previous = this.stream; this.stream = replacement;
        if (previous) this.inputStreams.add(previous);
        this.watchInput(replacement);
        try {
          await Promise.all([...this.peers].flatMap(([id, peer]) => peer.pc.getSenders().filter(sender => sender.track?.kind === 'audio').map(async sender => {
            try { await sender.replaceTrack(track); }
            catch (error) { if (!this.closed && this.peers.get(id) === peer) throw error; }
          })));
          if (this.closed || generation !== this.generation) { replacement.getTracks().forEach(track => track.stop()); return; }
          track.enabled = !this.state.muted && !this.state.deafened;
          if (request === this.inputRequest) { this.state.inputDevice = deviceId; this.emit(); }
        } finally { previous?.getTracks().forEach(track => track.stop()); if (previous) this.inputStreams.delete(previous); }
      });
      await this.inputUpdates;
    } catch (error) { next?.getTracks().forEach(track => track.stop()); if (!this.closed && request === this.inputRequest && generation === this.generation) this.fail(explain(error)); }
    finally { if (next) this.inputStreams.delete(next); }
  }
  private watchInput(stream: MediaStream) { for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => { if (!this.closed && this.stream === stream) this.fail('Se ha desconectado el micrófono. Comprueba el dispositivo y vuelve a unirte.'); }, { once: true }); }
  private async applyOutput(audio: HTMLAudioElement) { if ('setSinkId' in audio && typeof audio.setSinkId === 'function') await audio.setSinkId(this.state.outputDevice); }
  async setOutput(deviceId: string) {
    if (this.closed) return;
    this.state.outputDevice = deviceId;
    try { await Promise.all([...this.peers.values()].map(peer => this.applyOutput(peer.audio))); if (!this.closed) this.emit(); }
    catch { if (!this.closed) { this.state.error = 'El navegador no permite cambiar esta salida de audio.'; this.emit(); } }
  }
  async resumeAudio() {
    if (this.closed) return;
    try { await Promise.all([...this.peers.values()].map(peer => peer.audio.play())); if (!this.closed) { this.state.playbackBlocked = false; this.emit(); } }
    catch { if (!this.closed) { this.state.error = 'Autoriza la reproducción de sonido en el navegador.'; this.emit(); } }
  }
  private closePeer(peer: Peer) { peer.pc.onicecandidate = null; peer.pc.ontrack = null; peer.pc.onconnectionstatechange = null; peer.pc.close(); if (peer.audio.srcObject instanceof MediaStream) peer.audio.srcObject.getTracks().forEach(track => track.stop()); peer.audio.pause(); peer.audio.srcObject = null; peer.audio.remove(); }
  private fail(error: string) { this.leave(error); }
  leave(error = '') {
    if (this.closed) return;
    this.closed = true; this.generation++;
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    for (const stream of this.inputStreams) stream.getTracks().forEach(track => track.stop()); this.inputStreams.clear();
    for (const peer of this.peers.values()) this.closePeer(peer); this.peers.clear();
    clearInterval(this.heartbeat); this.pending = [];
    navigator.mediaDevices?.removeEventListener('devicechange', this.deviceChanged);
    if (this.state.participantId) void this.control('leave', {}).catch(() => {});
    this.state = { ...emptyVoiceState(), status: error ? 'error' : 'idle', error }; this.emit();
  }
}
