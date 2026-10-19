<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  let { title, close, children, wide = false }: { title: string; close: () => void; children: Snippet; wide?: boolean } = $props();
  let dialog: HTMLDialogElement;
  onMount(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus(); };
  });
</script>

<dialog bind:this={dialog} class:wide aria-labelledby="dialog-title" oncancel={(event) => { event.preventDefault(); close(); }} onclick={(event) => { if (event.target === dialog) close(); }} onkeydown={(event) => { if (event.key === 'Escape') { event.preventDefault(); close(); } }}>
  <div class="modal-inner">
    <header class="modal-header"><div><span class="eyebrow">TU ESPACIO, A TU MANERA</span><h2 id="dialog-title">{title}</h2></div><button class="icon-button" aria-label="Cerrar diálogo" onclick={close}><Icon name="close" /></button></header>
    {@render children()}
  </div>
</dialog>
