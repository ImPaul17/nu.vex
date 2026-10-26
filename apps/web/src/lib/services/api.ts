import type { Channel, Community, Member, Message } from '@nuvex/core';
import type { WorkspaceSnapshot } from './types';
import { createNativeTransport, isNative, NativeTransportError, type EventSocket } from './native';
import { decodeVoiceJoin, type VoiceJoin } from './voice';

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string) { super(message); }
}

export interface InstanceInfo { name: string; version: string; registrationOpen: boolean; authMethods: string[] }
export type ServerEvent = { type: 'message.created'; message: Message } | { type: 'message.deleted'; channelId: string; messageId: string } | { type: 'workspace.updated' | 'resync.required' };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('El servidor ha devuelto datos no válidos.');
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 4000): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('El servidor ha devuelto un campo no válido.');
  return value;
}
function list(value: unknown, max = 10_000): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error('El servidor ha devuelto una lista no válida.');
  return value;
}
function color(value: unknown): string { return typeof value === 'string' && /^#[a-f0-9]{6}$/i.test(value) ? value : '#7EE6C0'; }
export function decodeMember(value: unknown): Member {
  const item = object(value);
  const status = item.status === 'online' || item.status === 'idle' ? item.status : 'offline';
  return { id: text(item.id, 128), name: text(item.name, 80), handle: text(item.handle, 80), initials: text(item.initials, 8), color: color(item.color), role: text(item.role, 80), status, bio: text(item.bio, 2000) };
}
export function decodeChannel(value: unknown): Channel {
  const item = object(value);
  if (item.kind !== 'text' && item.kind !== 'voice') throw new Error('El tipo de canal no es compatible.');
  return { id: text(item.id, 128), name: text(item.name, 80), kind: item.kind, category: text(item.category, 80), description: text(item.description, 500) };
}
export function decodeCommunity(value: unknown): Community {
  const item = object(value);
  return { id: text(item.id, 128), name: text(item.name, 80), initials: text(item.initials, 8), color: color(item.color), description: text(item.description, 500), channels: list(item.channels, 1000).map(decodeChannel) };
}
export function decodeMessage(value: unknown): Message {
  const item = object(value); const createdAt = text(item.createdAt, 64);
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error('La fecha del mensaje no es válida.');
  return { id: text(item.id, 128), channelId: text(item.channelId, 128), authorId: text(item.authorId, 128), content: text(item.content), createdAt };
}
export function normalizeInstance(input: string, currentOrigin = window.location.origin): string {
  const url = new URL(input.trim() || currentOrigin);
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error('Introduce el origen de la instancia, sin ruta, contraseña ni parámetros.');
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('La instancia debe usar HTTPS. HTTP solo está permitido en el equipo local.');
  return url.origin;
}

export class InstanceApi {
  private accessToken: string | null = null;
  private credentialEpoch = 0;
  readonly baseUrl: string;
  readonly crossOrigin: boolean;
  private readonly native;
  constructor(baseUrl: string, currentOrigin = window.location.origin) {
    this.baseUrl = normalizeInstance(baseUrl, currentOrigin);
    this.crossOrigin = isNative || this.baseUrl !== currentOrigin;
    this.native = isNative ? createNativeTransport(this.baseUrl) : null;
  }
  private async request(path: string, options: RequestInit = {}): Promise<Record<string, unknown>> {
    const headers = new Headers(options.headers);
    if (options.body) headers.set('Content-Type', 'application/json');
    if (this.accessToken) headers.set('Authorization', `Bearer ${this.accessToken}`);
    let status: number;
    let value: unknown;
    const epoch = this.credentialEpoch;
    try {
      if (this.native) {
        const response = await this.native.request(path, { method: options.method, body: typeof options.body === 'string' ? options.body : undefined });
        status = response.status;
        value = response.payload;
      } else {
        const response = await fetch(`${this.baseUrl}/api/v1${path}`, { ...options, headers, credentials: this.crossOrigin ? 'omit' : 'include', cache: 'no-store', signal: AbortSignal.timeout(15_000) });
        status = response.status;
        value = status === 204 ? {} : await response.json().catch(() => ({}));
      }
    } catch { throw new ApiError('No se puede conectar con la instancia. Revisa su dirección, certificado y configuración de acceso.', 0, 'unreachable'); }
    const payload = object(value);
    if (status < 200 || status >= 300) {
      const error = payload.error && typeof payload.error === 'object' ? object(payload.error) : {};
      if (status === 401 && epoch === this.credentialEpoch) this.accessToken = null;
      throw new ApiError(typeof error.message === 'string' ? error.message : `La solicitud falló (${status}).`, status, typeof error.code === 'string' ? error.code : 'request_failed');
    }
    return payload;
  }
  async instance(): Promise<InstanceInfo> {
    const data = await this.request('/instance');
    return { name: text(data.name, 80), version: text(data.version, 40), registrationOpen: data.registrationOpen === true, authMethods: list(data.authMethods, 20).map((value) => text(value, 40)) };
  }
  async authenticate(mode: 'login' | 'register', input: { email: string; password: string; displayName?: string; handle?: string }): Promise<Member> {
    const epoch = ++this.credentialEpoch;
    const body = { email: input.email, password: input.password, ...(mode === 'register' ? { displayName: input.displayName, handle: input.handle } : {}), ...(this.crossOrigin ? { transport: 'bearer' } : {}) };
    const data = await this.request(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(body) });
    if (epoch !== this.credentialEpoch) throw new ApiError('La sesión ha cambiado.', 409, 'stale_session');
    if (this.crossOrigin && !this.native) {
      const token = text(data.accessToken, 512);
      if (token.length < 32) throw new Error('La instancia no admite el acceso remoto seguro.');
      this.accessToken = token;
    }
    return decodeMember(data.user);
  }
  async bootstrap(): Promise<WorkspaceSnapshot> {
    const data = await this.request('/bootstrap');
    return { user: decodeMember(data.user), communities: list(data.communities, 1000).map(decodeCommunity), members: list(data.members).map(decodeMember), messages: [] };
  }
  async messages(channelId: string, before?: string): Promise<Message[]> {
    const cursor = before ? `&before=${encodeURIComponent(before)}` : '';
    return list((await this.request(`/channels/${encodeURIComponent(channelId)}/messages?limit=100${cursor}`)).messages, 100).map(decodeMessage);
  }
  async send(channelId: string, content: string, clientId: string): Promise<Message> {
    return decodeMessage((await this.request(`/channels/${encodeURIComponent(channelId)}/messages`, { method: 'POST', body: JSON.stringify({ content, clientId }) })).message);
  }
  async createCommunity(name: string): Promise<Community> { return decodeCommunity((await this.request('/communities', { method: 'POST', body: JSON.stringify({ name }) })).community); }
  async createChannel(id: string, name: string, kind: 'text' | 'voice' = 'text'): Promise<Channel> { return decodeChannel((await this.request(`/communities/${encodeURIComponent(id)}/channels`, { method: 'POST', body: JSON.stringify({ name, ...(kind === 'voice' ? { kind } : {}) }) })).channel); }
  async joinVoice(channelId: string): Promise<VoiceJoin> { return decodeVoiceJoin(await this.request(`/channels/${encodeURIComponent(channelId)}/voice/join`, { method: 'POST', body: '{}' })); }
  async voiceControl(channelId: string, action: 'state' | 'leave' | 'heartbeat' | 'signal', body: Record<string, unknown>): Promise<void> { await this.request(`/channels/${encodeURIComponent(channelId)}/voice/${action}`, { method: 'POST', body: JSON.stringify(body) }); }
  async createInvite(id: string): Promise<string> { return text((await this.request(`/communities/${encodeURIComponent(id)}/invites`, { method: 'POST' })).code, 256); }
  async joinInvite(code: string): Promise<void> { await this.request(`/invites/${encodeURIComponent(code)}/join`, { method: 'POST' }); }
  async deleteMessage(message: Message): Promise<void> { await this.request(`/channels/${encodeURIComponent(message.channelId)}/messages/${encodeURIComponent(message.id)}`, { method: 'DELETE' }); }
  async logout(): Promise<void> {
    const epoch = ++this.credentialEpoch;
    try { await this.request('/auth/logout', { method: 'POST' }); }
    catch (cause) { if (!(cause instanceof ApiError && cause.status === 401)) throw cause; }
    if (epoch === this.credentialEpoch) this.accessToken = null;
  }
  async dispose(): Promise<void> { await this.native?.dispose(); }
  async eventSocket(): Promise<EventSocket> {
    if (this.native) {
      try { return await this.native.eventSocket(); }
      catch (cause) { if (cause instanceof NativeTransportError) throw new ApiError(cause.message, cause.status, cause.code); throw cause; }
    }
    const url = new URL(`${this.baseUrl}/api/v1/events`); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const ticket = await this.request('/events/ticket', { method: 'POST' }); url.searchParams.set('ticket', text(ticket.ticket, 256));
    return new WebSocket(url);
  }
}

export function decodeEvent(value: unknown): ServerEvent | null {
  try {
    const data = object(value);
    if (data.type === 'message.created') return { type: data.type, message: decodeMessage(data.message) };
    if (data.type === 'message.deleted') return { type: data.type, channelId: text(data.channelId, 128), messageId: text(data.messageId, 128) };
    if (data.type === 'workspace.updated' || data.type === 'resync.required') return { type: data.type };
  } catch { return null; }
  return null;
}
