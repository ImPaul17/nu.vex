import { Channel, invoke, isTauri } from '@tauri-apps/api/core';

export const isNative = typeof window !== 'undefined' && isTauri();

// Matching DOM event arguments keep the browser WebSocket structurally usable;
// this interface does not pretend the Rust stream is a browser WebSocket.
export interface EventSocket {
  onopen: ((event: Event) => unknown) | null;
  onmessage: ((event: MessageEvent) => unknown) | null;
  onclose: ((event: CloseEvent) => unknown) | null;
  onerror: ((event: Event) => unknown) | null;
  close(): void;
}
interface Connection { handle: string }
interface Packet { streamId: string; seq: number; type: 'open' | 'message' | 'close' | 'error'; data?: string }
interface Reply { status: number; payload: unknown }
interface RequestOptions { method?: string; body?: string }

export class NativeTransportError extends Error {
  constructor(message: string, public readonly status = 0, public readonly code = 'unreachable') { super(message); }
}
function transportError(value: unknown): NativeTransportError {
  if (value instanceof NativeTransportError) return value;
  if (value && typeof value === 'object' && 'message' in value && typeof value.message === 'string') {
    const status = 'status' in value && typeof value.status === 'number' ? value.status : 0;
    const code = 'code' in value && typeof value.code === 'string' ? value.code : 'unreachable';
    return new NativeTransportError(value.message, status, code);
  }
  return new NativeTransportError('No se pudo completar la operación nativa.');
}

class NativeSocket implements EventSocket {
  private callbacks: { open: EventSocket['onopen']; message: EventSocket['onmessage']; close: EventSocket['onclose']; error: EventSocket['onerror'] } = { open: null, message: null, close: null, error: null };
  private queue: Packet[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private streamId: string | null = null;
  readonly channel = new Channel<Packet>();
  constructor(private readonly handle: string, private readonly finished: () => void) {
    this.channel.onmessage = (packet) => {
      if (this.closed) return;
      if (this.queue.length >= 64) { this.close(); return; }
      this.queue.push(packet); this.schedule();
    };
  }
  get onopen() { return this.callbacks.open; }
  set onopen(value: EventSocket['onopen']) { this.callbacks.open = value; this.schedule(); }
  get onmessage() { return this.callbacks.message; }
  set onmessage(value: EventSocket['onmessage']) { this.callbacks.message = value; this.schedule(); }
  get onclose() { return this.callbacks.close; }
  set onclose(value: EventSocket['onclose']) { this.callbacks.close = value; this.schedule(); }
  get onerror() { return this.callbacks.error; }
  set onerror(value: EventSocket['onerror']) { this.callbacks.error = value; this.schedule(); }
  attach(streamId: string) {
    this.streamId = streamId;
    if (this.closed) void this.control({ type: 'close' });
  }
  private async control(control: { type: 'ack'; seq: number } | { type: 'close' }) {
    if (!this.streamId) return;
    await invoke('nuvex_events_control', { handle: this.handle, streamId: this.streamId, control }).catch(() => undefined);
  }
  private schedule() {
    if (this.closed || this.timer !== undefined) return;
    // A task (rather than an eager onmessage callback) gives await eventSocket()
    // callers time to install all handlers, including for an already-open IPC stream.
    this.timer = setTimeout(() => { this.timer = undefined; this.flush(); }, 0);
  }
  private flush() {
    while (!this.closed && this.queue.length) {
      const packet = this.queue[0];
      if (!this.callbacks[packet.type]) return;
      this.queue.shift();
      try {
        if (packet.type === 'open') this.callbacks.open?.(new Event('open'));
        else if (packet.type === 'message') this.callbacks.message?.(new MessageEvent('message', { data: packet.data }));
        else if (packet.type === 'error') this.callbacks.error?.(new Event('error'));
        else this.callbacks.close?.(new CloseEvent('close'));
      } finally { void this.control({ type: 'ack', seq: packet.seq }); }
      if (packet.type === 'close') { this.closed = true; this.queue = []; this.finished(); }
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer); this.timer = undefined; this.queue = [];
    void this.control({ type: 'close' });
    this.finished();
    // Match the asynchronous close notification expected by the reconnect logic.
    setTimeout(() => this.callbacks.close?.(new CloseEvent('close')), 0);
  }
}

let selectionOrder = 0;
export function createNativeTransport(baseUrl: string) {
  const order = ++selectionOrder;
  let disposed = false;
  let connection: Promise<Connection> | null = null;
  let credentialEpoch = 0;
  const sockets = new Set<NativeSocket>();
  function closeSockets() { for (const socket of sockets) socket.close(); sockets.clear(); }
  async function selected(): Promise<Connection> {
    if (disposed) throw new NativeTransportError('La conexión ha cambiado.', 409, 'stale_session');
    connection ??= invoke<Connection>('nuvex_connect', { origin: baseUrl, order }).catch((error: unknown) => { throw transportError(error); });
    const value = await connection;
    if (disposed) {
      await invoke('nuvex_dispose', { handle: value.handle }).catch(() => undefined);
      throw new NativeTransportError('La conexión ha cambiado.', 409, 'stale_session');
    }
    return value;
  }
  return {
    async request(path: string, options: RequestOptions = {}): Promise<Reply> {
      try {
        const { handle } = await selected();
        if (path === '/auth/login' || path === '/auth/register') { credentialEpoch++; closeSockets(); }
        const epoch = credentialEpoch;
        const reply = await invoke<Reply>('nuvex_request', { handle, path, method: options.method, body: options.body });
        if (disposed || epoch !== credentialEpoch) throw new NativeTransportError('La conexión ha cambiado.', 409, 'stale_session');
        if (reply.status === 401 || (path === '/auth/logout' && reply.status >= 200 && reply.status < 300)) { credentialEpoch++; closeSockets(); }
        return reply;
      } catch (cause) {
        const error = transportError(cause);
        return { status: error.status, payload: { error: { code: error.code, message: error.message } } };
      }
    },
    async eventSocket(): Promise<EventSocket> {
      const { handle } = await selected();
      const epoch = credentialEpoch;
      let socket: NativeSocket;
      socket = new NativeSocket(handle, () => sockets.delete(socket));
      sockets.add(socket);
      try {
        const { streamId } = await invoke<{ streamId: string }>('nuvex_events', { handle, channel: socket.channel });
        socket.attach(streamId);
        if (disposed || epoch !== credentialEpoch) { socket.close(); throw new NativeTransportError('La conexión ha cambiado.', 409, 'stale_session'); }
        return socket;
      } catch (cause) { socket.close(); throw transportError(cause); }
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true; closeSockets();
      if (connection) {
        const value = await connection.catch(() => null);
        if (value) await invoke('nuvex_dispose', { handle: value.handle }).catch(() => undefined);
      }
    },
  };
}
