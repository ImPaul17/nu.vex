<script lang="ts">
  import { tick } from 'svelte';
  import type { Message } from '@nuvex/core';
  import Icon from './Icon.svelte';
  let { channelName, send, replyTo = null, cancelReply, local = true, statusLabel = 'Demo local · los mensajes se borran al recargar' }: { channelName: string; send: (text: string, attachment?: Message['attachment']) => boolean | Promise<boolean>; replyTo?: Message | null; cancelReply: () => void; local?: boolean; statusLabel?: string } = $props();
  let text = $state('');
  let emojiOpen = $state(false);
  let attachment = $state<Message['attachment']>();
  let error = $state('');
  let pending = $state(false);
  let input: HTMLTextAreaElement;
  let fileInput = $state<HTMLInputElement>();
  let emojiButton: HTMLButtonElement;
  const replyPrefix = $derived(replyTo ? `↪ ${replyTo.content.slice(0, 80)}\n\n` : '');
  const maxLength = $derived(4000 - replyPrefix.length);
  const emojis = ['💚', '✨', '🌱', '👋', '🎉', '🙌', '🏡', '😊', '🚀', '☕', '👀', '🛠️'];
  async function submit() {
    if (!text.trim() || pending) return;
    const body = replyPrefix + text;
    pending = true;
    try { if (await send(body, attachment)) { text = ''; attachment = undefined; error = ''; cancelReply(); } }
    finally { pending = false; await tick(); input?.focus(); }
  }
  async function closeEmoji() { emojiOpen = false; await tick(); emojiButton?.focus(); }
  function emojiKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && emojiOpen) { event.stopPropagation(); void closeEmoji(); }
  }
  function selectFile(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) { error = 'La vista previa admite archivos de hasta 10 MB.'; }
      else { attachment = { name: file.name, size: file.size, mimeType: file.type }; error = ''; }
    }
    if (fileInput) fileInput.value = '';
  }
  $effect(() => { if (replyTo) void tick().then(() => input?.focus()); });
</script>

<div class="composer-zone">
  {#if replyTo}<div class="reply-preview"><Icon name="link" size={14} /><span>Responder: {replyTo.content.slice(0, 70)}</span><button class="icon-button" aria-label="Cancelar respuesta" onclick={cancelReply}><Icon name="close" size={14} /></button></div>{/if}
  {#if attachment}<div class="reply-preview"><Icon name="attach" size={14} /><span>{attachment.name} · vista previa, no se subirá el archivo</span><button class="icon-button" aria-label="Quitar adjunto" onclick={() => attachment = undefined}><Icon name="close" size={14} /></button></div>{/if}
  <form class="composer" aria-busy={pending} onsubmit={(event) => { event.preventDefault(); void submit(); }}>
    {#if local}
    <input type="file" class="visually-hidden" tabindex="-1" aria-label="Seleccionar archivo para vista previa" bind:this={fileInput} onchange={selectFile} />
    <button class="icon-button attachment-button" type="button" aria-label="Adjuntar archivo local de muestra" title="Vista previa de adjunto" onclick={() => fileInput?.click()}><Icon name="plus" size={21} /></button>
    {/if}
    <textarea bind:this={input} bind:value={text} rows="1" maxlength={maxLength} disabled={pending} aria-label="Escribir mensaje" placeholder="Escribe en #{channelName}…" onkeydown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void submit(); } }}></textarea>
    <div class="emoji-control"><button bind:this={emojiButton} class="icon-button" type="button" aria-label="Elegir emoji" aria-expanded={emojiOpen} onkeydown={emojiKeydown} onclick={() => emojiOpen = !emojiOpen}><Icon name="smile" size={21} /></button>{#if emojiOpen}<div class="emoji-popover" aria-label="Emojis">{#each emojis as emoji}<button type="button" aria-label="Insertar {emoji}" onkeydown={emojiKeydown} onclick={() => { text = (text + emoji).slice(0, maxLength); emojiOpen = false; input.focus(); }}>{emoji}</button>{/each}<button type="button" class="emoji-close" aria-label="Cerrar emojis" onkeydown={emojiKeydown} onclick={() => void closeEmoji()}><Icon name="close" size={16} /></button></div>{/if}</div>
    <span class="composer-divider"></span><button class="send-button" type="submit" aria-label={local ? 'Enviar mensaje local' : 'Enviar mensaje'} disabled={!text.trim() || pending}><Icon name="send" size={18} /></button>
  </form>
  <div class="composer-caption"><span><span class="status-dot"></span> {pending ? 'Enviando…' : statusLabel}</span><span><kbd>↵</kbd> enviar <span class="caption-space">·</span> <kbd>Shift ↵</kbd> salto de línea</span></div>
  {#if error}<p class="form-error" role="alert">{error}</p>{/if}
</div>
