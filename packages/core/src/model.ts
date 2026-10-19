/** Local presentation contracts. These are not a server protocol or authorization model. */
export interface Channel {
  id: string;
  name: string;
  kind: 'text' | 'voice';
  category: string;
  description: string;
  unread?: number;
}

export interface Community {
  id: string;
  name: string;
  initials: string;
  color: string;
  description: string;
  channels: Channel[];
}

export interface Member {
  id: string;
  name: string;
  handle: string;
  initials: string;
  color: string;
  role: string;
  status: 'online' | 'idle' | 'offline';
  bio: string;
}

export interface Message {
  id: string;
  channelId: string;
  authorId: string;
  content: string;
  createdAt: string;
  reactions?: { emoji: string; count: number }[];
  attachment?: { name: string; size: number; mimeType?: string };
}

export const MAX_MESSAGE_LENGTH = 4_000;

/** Validates plain message text; callers must render it as text, never trusted HTML. */
export function validateMessageContent(content: unknown): string {
  if (typeof content !== 'string') {
    throw new Error('El mensaje debe ser texto.');
  }

  const text = content.trim();
  if (text.length === 0) {
    throw new Error('Escribe un mensaje antes de enviarlo.');
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`El mensaje admite hasta ${MAX_MESSAGE_LENGTH} caracteres.`);
  }
  return text;
}

/** Creates a transient local demo message. It does not persist or send any data. */
export function createLocalMessage(
  channelId: string,
  authorId: string,
  content: string,
  options: { id?: string; now?: Date } = {},
): Message {
  const text = validateMessageContent(content);
  if (!channelId.trim() || !authorId.trim()) {
    throw new Error('El mensaje necesita un canal y un autor.');
  }
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error('La fecha del mensaje no es válida.');
  }
  return {
    id: options.id ?? crypto.randomUUID(),
    channelId,
    authorId,
    content: text,
    createdAt: now.toISOString(),
  };
}
