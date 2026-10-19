<script lang="ts">
  import type { Message, Member } from '@nuvex/core';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  let { message, author, grouped = false, profile, reply, remove, react, currentUserId = 'you', local = true }: {
    message: Message; author: Member; grouped?: boolean;
    profile: (member: Member) => void; reply: (message: Message) => void;
    remove: (id: string) => void; react: (id: string, emoji: string) => void;
    currentUserId?: string; local?: boolean;
  } = $props();
  const formatTime = (iso: string) => new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).format(new Date(iso));
</script>

<article class="message" class:grouped aria-label="Mensaje de {author.name}">
  <div class="message-avatar">{#if !grouped}<button class="avatar-button" aria-label="Ver perfil de {author.name}" onclick={() => profile(author)}><Avatar member={author} /></button>{:else}<time class="group-time" datetime={message.createdAt}>{formatTime(message.createdAt)}</time>{/if}</div>
  <div class="message-body">
    {#if !grouped}<div class="message-meta"><button class="author-name" style:color={author.color} onclick={() => profile(author)}>{author.name}</button>{#if author.id === currentUserId}<span class="role-label">TÚ</span>{/if}<time datetime={message.createdAt}>{formatTime(message.createdAt)}</time></div>{/if}
    <p>{message.content}</p>
    {#if message.attachment}<div class="attachment-card"><Icon name="attach" size={24} /><div><strong>{message.attachment.name}</strong><span>{(message.attachment.size / 1024).toFixed(1)} KB · solo metadatos locales</span></div><span class="tag">DEMO</span></div>{/if}
    {#if message.reactions?.length}<div class="reactions">{#each message.reactions as reaction}<button title="Reaccionar con {reaction.emoji} en esta demo" onclick={() => react(message.id, reaction.emoji)}>{reaction.emoji}<span>{reaction.count}</span></button>{/each}</div>{/if}
  </div>
  <div class="message-actions"><button class="icon-button" title="Responder" aria-label="Responder a {author.name}" onclick={() => reply(message)}><Icon name="link" size={16} /></button>{#if local}<button class="icon-button" title="Añadir reacción local" aria-label="Añadir corazón" onclick={() => react(message.id, '💚')}><Icon name="smile" size={16} /></button>{/if}{#if author.id === currentUserId && !message.id.startsWith('demo-')}<button class="icon-button danger" title={local ? 'Eliminar mensaje local' : 'Eliminar mensaje'} aria-label={local ? 'Eliminar mensaje local' : 'Eliminar mensaje'} onclick={() => remove(message.id)}><Icon name="close" size={16} /></button>{/if}</div>
</article>
