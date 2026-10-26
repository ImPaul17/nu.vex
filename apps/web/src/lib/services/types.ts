import type { Channel, Community, Member, Message } from '@nuvex/core';

export interface WorkspaceSnapshot {
  user: Member;
  communities: Community[];
  members: Member[];
  messages: Message[];
  historyGeneration?: number;
}

export interface WorkspaceActions {
  selectChannel(channel: Channel): Promise<void>;
  loadEarlier(channelId: string, before: string): Promise<number>;
  send(channelId: string, content: string): Promise<void>;
  createCommunity(name: string): Promise<Community>;
  createChannel(communityId: string, name: string): Promise<Channel>;
  createInvite(communityId: string): Promise<string>;
  joinInvite(code: string): Promise<void>;
  deleteMessage(message: Message): Promise<void>;
  logout(): Promise<void>;
}

export type ConnectionStatus = 'connecting' | 'online' | 'reconnecting' | 'offline';

export type InstanceChoice = { url: string; name: string; account?: string };
