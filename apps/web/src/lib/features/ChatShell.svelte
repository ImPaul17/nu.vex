<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { demoCommunities, demoMembers, demoMessages, createLocalMessage, defaultTheme, parseTheme, serializeTheme, validateTheme, accentForeground, type Community, type Channel, type Member, type Message, type ThemePreferences } from '@nuvex/core';
  import { isNative } from '$lib/services/native';
  import Icon from '$lib/components/Icon.svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import MessageItem from '$lib/components/MessageItem.svelte';
  import Composer from '$lib/components/Composer.svelte';
  import Appearance from '$lib/components/Appearance.svelte';
  import type { WorkspaceActions, WorkspaceSnapshot, ConnectionStatus, InstanceChoice } from '$lib/services/types';

  let { snapshot = null, actions = null, connectionStatus = 'offline', instanceName = 'Demo local', instanceUrl = '', instances = [], switchInstance, manageInstances }: { snapshot?: WorkspaceSnapshot | null; actions?: WorkspaceActions | null; connectionStatus?: ConnectionStatus; instanceName?: string; instanceUrl?: string; instances?: InstanceChoice[]; switchInstance?: (url: string) => void | Promise<void>; manageInstances?: () => void } = $props();
  const live = $derived(!!snapshot && !!actions);

  let localCommunities = $state<Community[]>(structuredClone(demoCommunities));
  let localMessages = $state<Message[]>(structuredClone(demoMessages));
  const communities = $derived(snapshot?.communities ?? localCommunities);
  const messages = $derived(snapshot?.messages ?? localMessages);
  const members = $derived(snapshot?.members ?? demoMembers);
  let communityId = $state('nuvex');
  let channelId = $state('general');
  let query = $state('');
  let membersVisible = $state(false);
  let focusMode = $state(false);
  let collapsedCategories = $state<string[]>([]);
  let channelsVisible = $state(false);
  let preferences = $state<ThemePreferences>({ ...defaultTheme });
  let modal = $state<'appearance' | 'community' | 'channel' | 'about' | 'settings' | 'community-info' | 'pins' | 'invite' | 'join' | null>(null);
  let profile = $state<Member | null>(null);
  let formName = $state('');
  let formError = $state('');
  let formPending = $state(false);
  let inviteCode = $state('');
  let historyPending = $state(false);
  let exhaustedChannels = $state<string[]>([]);
  let notice = $state('');
  let replyTo = $state<Message | null>(null);
  let muted = $state(false);
  let searchInput: HTMLInputElement;
  let channelSidebar: HTMLElement;
  let channelMenuButton: HTMLButtonElement;
  let mainPanel: HTMLElement;
  let scrollPanel = $state<HTMLDivElement>();
  let noticeTimeout: ReturnType<typeof setTimeout>;
  const me = $derived(snapshot?.user ?? demoMembers.find((member) => member.id === 'you')!);
  const community = $derived(communities.find((item) => item.id === communityId) ?? communities[0]);
  const channel = $derived(community.channels.find((item) => item.id === channelId) ?? community.channels[0]);
  const historyKey = $derived(`${snapshot?.historyGeneration ?? 0}:${channel.id}`);
  const visibleMessages = $derived(messages.filter((message) => message.channelId === channel.id && (!query || message.content.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')) || author(message.authorId).name.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')))));
  const categories = $derived([...new Set(community.channels.map((item) => item.category))]);
  const online = $derived(live ? members : members.filter((member) => member.status !== 'offline'));
  const offline = $derived(live ? [] : members.filter((member) => member.status === 'offline'));
  const reactions = new Set<string>();

  onMount(() => {
    try { const stored = localStorage.getItem('nuvex:appearance:v1'); if (stored) preferences = parseTheme(stored); }
    catch { notify('No se pudieron recuperar tus preferencias. Se usará el tema original.'); }
    return () => clearTimeout(noticeTimeout);
  });
  function author(id: string) { return members.find((member) => member.id === id) ?? { ...me, id, name: 'Usuario', initials: '?', handle: 'usuario', role: 'Miembro' }; }
  function notify(text: string) { notice = text; clearTimeout(noticeTimeout); noticeTimeout = setTimeout(() => notice = '', 5500); }
  function openModal(value: typeof modal) { formError = ''; formName = ''; inviteCode = ''; modal = value; }
  function toggleCategory(category: string) { collapsedCategories = collapsedCategories.includes(category) ? collapsedCategories.filter((item) => item !== category) : [...collapsedCategories, category]; }
  function selectCommunity(item: Community) { communityId = item.id; selectChannel(item.channels[0]); }
  function selectChannel(item: Channel) {
    const fromDrawer = channelsVisible;
    channelId = item.id; query = ''; replyTo = null; channelsVisible = false;
    if (actions) void actions.selectChannel(item).catch((error) => notify(error instanceof Error ? error.message : 'No se pudo cargar el canal.'));
    if (fromDrawer) void tick().then(() => mainPanel?.focus());
  }
  async function openChannels() { channelsVisible = true; await tick(); channelSidebar?.querySelector<HTMLButtonElement>('button')?.focus(); }
  async function closeChannels() { channelsVisible = false; await tick(); channelMenuButton?.focus(); }
  function trapChannels(event: KeyboardEvent) {
    if (!channelsVisible || event.key !== 'Tab') return;
    const buttons = channelSidebar.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    const first = buttons[0]; const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  function changeTheme(value: ThemePreferences) {
    preferences = validateTheme(value);
    try { localStorage.setItem('nuvex:appearance:v1', serializeTheme(preferences)); }
    catch { notify('El tema se aplicó, pero este navegador no permite guardar preferencias.'); }
  }
  async function scrollToEnd() { await tick(); scrollPanel?.scrollTo({ top: scrollPanel.scrollHeight, behavior: 'instant' }); }
  async function loadEarlier() {
    if (!actions || historyPending) return;
    const first = messages.find((message) => message.channelId === channel.id); if (!first) return;
    const previousHeight = scrollPanel?.scrollHeight ?? 0; const previousTop = scrollPanel?.scrollTop ?? 0; const id = channel.id; const key = historyKey;
    historyPending = true;
    try { const count = await actions.loadEarlier(id, first.id); if (count < 100) exhaustedChannels = [...exhaustedChannels, key]; await tick(); if (scrollPanel && channel.id === id) scrollPanel.scrollTop = previousTop + scrollPanel.scrollHeight - previousHeight; }
    catch (error) { notify(error instanceof Error ? error.message : 'No se pudo cargar el historial.'); }
    finally { historyPending = false; }
  }
  async function send(text: string, attachment?: Message['attachment']): Promise<boolean> {
    try {
      if (actions) { await actions.send(channel.id, text); query = ''; await scrollToEnd(); return true; }
      const message = createLocalMessage(channelId, 'you', text);
      if (attachment) message.attachment = attachment;
      localMessages = [...localMessages, message]; query = ''; void scrollToEnd(); return true;
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'No se pudo crear el mensaje local.'); return false; }
  }
  async function createCommunity(event: SubmitEvent) {
    event.preventDefault(); const name = formName.trim();
    if (formPending) return;
    if (!name || name.length > 48) { formError = 'Escribe un nombre de entre 1 y 48 caracteres.'; return; }
    if (actions) { formPending = true; try { selectCommunity(await actions.createCommunity(name)); modal = null; notify('Comunidad creada.'); } catch (error) { formError = error instanceof Error ? error.message : 'No se pudo crear la comunidad.'; } finally { formPending = false; } return; }
    const id = crypto.randomUUID();
    const item: Community = { id, name, initials: name.slice(0, 2).toLowerCase(), color: '#7EE6C0', description: 'Tu nuevo espacio de demostración.', channels: [{ id: `${id}-general`, name: 'general', kind: 'text', category: 'COMUNIDAD', description: 'Todo empieza con una conversación.' }] };
    localCommunities = [...localCommunities, item]; selectCommunity(item); modal = null; notify('Comunidad creada en esta sesión local.');
  }
  async function createChannel(event: SubmitEvent) {
    event.preventDefault(); const name = formName.trim().toLocaleLowerCase('es').replace(/\s+/g, '-');
    if (formPending) return;
    if (!/^[\p{L}\p{N}_-]{1,40}$/u.test(name)) { formError = 'Usa entre 1 y 40 letras, números, guiones o guiones bajos.'; return; }
    if (community.channels.some((item) => item.name === name)) { formError = 'Ya existe un canal con ese nombre.'; return; }
    if (actions) { formPending = true; try { selectChannel(await actions.createChannel(community.id, name)); modal = null; notify('Canal creado.'); } catch (error) { formError = error instanceof Error ? error.message : 'No se pudo crear el canal.'; } finally { formPending = false; } return; }
    const item: Channel = { id: crypto.randomUUID(), name, kind: 'text', category: 'COMUNIDAD', description: 'Un nuevo lugar para compartir.' };
    localCommunities = localCommunities.map((space) => space.id === communityId ? { ...space, channels: [...space.channels, item] } : space);
    selectChannel(item); modal = null; notify('Canal creado en esta sesión local.');
  }
  function react(id: string, emoji: string) {
    const key = `${id}:${emoji}`; const delta = reactions.has(key) ? -1 : 1;
    if (delta === 1) reactions.add(key); else reactions.delete(key);
    localMessages = localMessages.map((message) => {
      if (message.id !== id) return message;
      const list = [...(message.reactions ?? [])]; const index = list.findIndex((reaction) => reaction.emoji === emoji);
      if (index === -1) list.push({ emoji, count: 1 }); else list[index] = { emoji, count: list[index].count + delta };
      return { ...message, reactions: list.filter((reaction) => reaction.count > 0) };
    });
  }
  async function removeMessage(message: Message) { try { if (actions) await actions.deleteMessage(message); else localMessages = localMessages.filter((item) => item.id !== message.id); } catch (error) { notify(error instanceof Error ? error.message : 'No se pudo eliminar el mensaje.'); } }
  async function makeInvite() { if (!actions) return; formPending = true; try { inviteCode = await actions.createInvite(community.id); } catch (error) { formError = error instanceof Error ? error.message : 'No se pudo crear la invitación.'; } finally { formPending = false; } }
  async function joinCommunity(event: SubmitEvent) { event.preventDefault(); if (!actions) return; formPending = true; try { await actions.joinInvite(formName.trim()); modal = null; notify('Ya formas parte de la comunidad.'); } catch (error) { formError = error instanceof Error ? error.message : 'No se pudo aceptar la invitación.'; } finally { formPending = false; } }
  function shortcut(event: KeyboardEvent) {
    if (modal || profile) return;
    if (channelsVisible && event.key === 'Tab') { trapChannels(event); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchInput?.focus(); }
    if (event.key === 'Escape') { if (channelsVisible) void closeChannels(); query = ''; }
  }
  const dayLabel = (iso: string) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' }).format(new Date(iso));
</script>

<svelte:head><title>#{channel.name} · {community.name} — nu.vex</title></svelte:head>
<svelte:window onkeydown={shortcut} />

<div class="app" data-theme={preferences.theme} data-density={preferences.density} style:--accent={preferences.accent} style:--accent-text={accentForeground(preferences.accent)} style:--glass={preferences.glass} style:--radius="{preferences.radius}px" class:members-visible={membersVisible} class:focus-mode={focusMode}>
  <a class="skip-link" href="#conversation">Saltar a la conversación</a>
  <header class="app-topbar" inert={channelsVisible}>
    <div class="wordmark"><img src="/brand/logo-app.svg" alt="nu.vex" width="106" height="23" /></div>
    {#if live && manageInstances}<button class="instance-switcher" aria-label="Cambiar de instancia" onclick={manageInstances}><Icon name="globe" size={15} /><span>{instanceName}</span><Icon name="chevron" size={13} /></button>{:else}<span class="topbar-caption">Un espacio para tu gente</span>{/if}
    <div class="topbar-right"><button class="focus-toggle" aria-pressed={focusMode} onclick={() => focusMode = !focusMode}><Icon name={focusMode ? 'menu' : 'spark'} size={15} /><span>{focusMode ? 'Mostrar navegación' : 'Modo concentración'}</span></button><span class="preview-badge" class:reconnecting={live && connectionStatus !== 'online'}><span></span> {live ? connectionStatus === 'online' ? 'Conectado' : connectionStatus === 'reconnecting' ? 'Reconectando…' : 'Conectando…' : 'Demo local'} <span class="alpha-pill">Alpha</span></span><button class="icon-button" aria-label="Acerca de nu.vex" onclick={() => openModal('about')}><Icon name="help" size={18} /></button></div>
  </header>
  <div class="workspace">
    <nav class="community-rail" aria-label="Comunidades" inert={channelsVisible}>
      <button class="app-icon" title="Acerca de nu.vex" aria-label="Inicio de nu.vex" onclick={() => openModal('about')}><img src="/brand/logo-app.png" alt="" width="44" height="44" /></button>
      <span class="rail-divider"></span>
      {#each communities as space}<button class="community-icon" class:active={community.id === space.id} style:--community-color={space.color} title={space.name} aria-label="Comunidad {space.name}" aria-current={community.id === space.id ? 'true' : undefined} onclick={() => selectCommunity(space)}>{#if space.id === 'nuvex'}<img src="/brand/logo-2.svg" alt="" width="27" height="23" />{:else}{space.initials}{/if}{#if space.id === 'design-lab'}<span class="rail-notification"></span>{/if}</button>{/each}
      <button class="community-icon add-community" aria-label="Crear comunidad" title={live ? 'Crear comunidad' : 'Crear comunidad local'} onclick={() => openModal('community')}><Icon name="plus" size={23} /></button>
      <div class="rail-bottom">{#if manageInstances}<button class="icon-button" aria-label="Gestionar instancias" title="Tus instancias" onclick={manageInstances}><Icon name="globe" size={22} /></button>{/if}<button class="icon-button" aria-label={live ? 'Unirse a una comunidad' : 'Explorar el proyecto'} title={live ? 'Unirse con invitación' : 'Explorar el proyecto'} onclick={() => openModal(live ? 'join' : 'about')}><Icon name="compass" size={23} /></button><button class="icon-button" aria-label="Abrir ajustes" title="Ajustes" onclick={() => openModal('settings')}><Icon name="settings" size={22} /></button><span class="version-label">α 0.2</span></div>
    </nav>
    {#if channelsVisible}<button class="mobile-backdrop" tabindex="-1" aria-label="Cerrar navegación de canales" onclick={() => void closeChannels()}></button>{/if}
    <aside bind:this={channelSidebar} class="channel-sidebar" class:mobile-open={channelsVisible} aria-label="Canales de {community.name}">
      <button class="community-heading" onclick={() => openModal('community-info')}><span>{community.name === 'nu.vex' ? 'Comunidad nu.vex' : community.name}</span><Icon name="chevron" size={17} /></button>
      <div class="community-meta"><span class="status-dot"></span> {#if !live}{online.length} en línea <span>·</span>{/if} {members.length} miembros {#if !live}<span class="tiny-tag">DEMO</span>{/if}</div>
      <div class="channel-list">
        {#each categories as category}<div class="channel-category"><div class="category-heading"><button class="category-toggle" aria-expanded={!collapsedCategories.includes(category)} onclick={() => toggleCategory(category)}><Icon name="chevron" size={12} /> {category}</button>{#if category === categories[0]}<button class="icon-button" aria-label="Crear canal" title={live ? 'Crear canal de texto' : 'Crear canal de texto local'} onclick={() => openModal('channel')}><Icon name="plus" size={16} /></button>{/if}</div>
          {#if !collapsedCategories.includes(category)}{#each community.channels.filter((item) => item.category === category) as item}<button class="channel-button" class:active={channel.id === item.id} class:unread={item.unread && channel.id !== item.id} aria-current={channel.id === item.id ? 'page' : undefined} onclick={() => selectChannel(item)}><Icon name={item.kind === 'voice' ? 'volume' : 'hash'} size={19} /><span>{item.name}</span>{#if item.unread && channel.id !== item.id}<span class="unread-count">{item.unread}</span>{/if}{#if item.kind === 'voice'}<span class="soon-dot" title="Voz en preparación"></span>{/if}</button>{/each}{/if}
        </div>{/each}
      </div>
      <button class="personalize-card" onclick={() => openModal('appearance')}><span class="personalize-icon"><Icon name="palette" size={19} /></span><span><strong>Un espacio más tuyo</strong><small>Apariencia y temas</small></span><Icon name="arrow" size={15} /></button>
      <div class="account-panel"><button class="account-profile" aria-label="Ver tu perfil" onclick={() => profile = me}><Avatar member={me} size={33} presence /><span><strong>{me.name}</strong><small>{live ? instanceName : 'En línea · demo'}</small></span></button><button class="icon-button" aria-label="Ajustes de cuenta" title="Ajustes de cuenta" onclick={() => openModal('settings')}><Icon name="settings" size={18} /></button></div>
    </aside>
    <main bind:this={mainPanel} class="main-panel" id="conversation" tabindex="-1" inert={channelsVisible}>
      <header class="channel-header"><button bind:this={channelMenuButton} class="icon-button mobile-menu" aria-label="Mostrar canales" aria-expanded={channelsVisible} onclick={() => void openChannels()}><Icon name="menu" /></button><span class="channel-heading-icon"><Icon name={channel.kind === 'voice' ? 'volume' : 'hash'} size={23} /></span><h1 title={channel.name}>{channel.name}</h1><span class="header-description">{channel.description}</span><div class="channel-tools"><button class="icon-button" class:tool-muted={muted} aria-label={muted ? 'Activar indicador de notificaciones' : 'Silenciar indicador de notificaciones'} title="Indicador local de notificaciones" aria-pressed={muted} onclick={() => { muted = !muted; notify(muted ? 'Indicador silenciado en esta sesión. Aún no hay notificaciones del servidor.' : 'Indicador activado en esta sesión.'); }}><Icon name="bell" size={19} /></button><button class="icon-button pin-button" aria-label="Ver mensajes fijados" onclick={() => openModal('pins')}><Icon name="pin" size={18} /></button><button class="icon-button" class:tool-active={membersVisible} aria-label="Mostrar miembros" aria-pressed={membersVisible} onclick={() => membersVisible = !membersVisible}><Icon name="users" size={20} /></button></div></header>
      <div class="conversation-toolbar"><div class="breadcrumb"><span class="status-dot"></span><span>{channel.kind === 'voice' ? 'Espacio de voz' : 'Conversación de la comunidad'}</span>{#if !live}<span class="tiny-tag">DEMO</span>{/if}</div><label class="search-field"><Icon name="search" size={15} /><input bind:this={searchInput} bind:value={query} aria-label="Buscar mensajes en este canal" placeholder={live ? 'Buscar mensajes cargados' : 'Buscar en este canal'} />{#if query}<button class="icon-button" aria-label="Limpiar búsqueda" onclick={() => query = ''}><Icon name="close" size={13} /></button>{:else}<kbd>Ctrl K</kbd>{/if}</label></div>
      {#if channel.kind === 'voice'}<div class="voice-empty"><div class="welcome-symbol"><Icon name="volume" size={32} /></div><span class="eyebrow">ESPACIOS PARA ESTAR JUNTOS</span><h2>La conversación tendrá voz.</h2><p>Los canales de voz llegarán en la fase 3, con WebRTC y señalización segura. Esta vista todavía no establece ninguna conexión.</p><span class="tag">PLANIFICADO · FASE 3</span><button class="secondary-button" onclick={() => selectChannel(community.channels.find((item) => item.kind === 'text')!)}>Volver a los mensajes <Icon name="arrow" size={16} /></button></div>
      {:else}
        <div class="conversation-scroll" bind:this={scrollPanel}>
          <section class="conversation-intro"><div class="intro-heading"><div class="welcome-symbol"><Icon name="hash" size={25} /></div><span class="intro-kicker">{community.name === 'nu.vex' ? 'TU COMUNIDAD, TU ESPACIO' : community.name}</span></div><h2>Un lugar para decir hola<span>.</span></h2><p>Este es <strong>#{channel.name}</strong>. Comparte una idea o empieza una conversación.</p></section>
          {#if query}<div class="search-result-label">{visibleMessages.length} {visibleMessages.length === 1 ? 'resultado' : 'resultados'} para “{query}”</div>{/if}
          {#if live && !query && messages.filter((message) => message.channelId === channel.id).length >= 100 && !exhaustedChannels.includes(historyKey)}<div class="history-pagination"><button class="secondary-button" disabled={historyPending} onclick={() => void loadEarlier()}>{historyPending ? 'Cargando…' : 'Cargar mensajes anteriores'}</button></div>{/if}
          <div class="messages" aria-label={live ? 'Historial de mensajes' : 'Historial de mensajes locales'}>
            {#each visibleMessages as message, index (message.id)}
              {@const previous = visibleMessages[index - 1]}
              {@const newDay = !previous || dayLabel(previous.createdAt) !== dayLabel(message.createdAt)}
              {#if newDay}<div class="date-divider"><span>{dayLabel(message.createdAt)}</span></div>{/if}
              <MessageItem {message} currentUserId={me.id} local={!live} author={author(message.authorId)} grouped={!newDay && previous?.authorId === message.authorId && new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < 300_000} profile={(member) => profile = member} reply={(item) => replyTo = item} remove={() => void removeMessage(message)} {react} />
            {:else}<div class="empty-state"><Icon name={query ? 'search' : 'smile'} size={30} /><h3>{query ? 'No encontramos esa conversación.' : 'El primer mensaje puede ser el tuyo.'}</h3><p>{query ? 'Prueba con otra palabra o con el nombre de una persona.' : 'Escribe un hola para estrenar este espacio.'}</p></div>{/each}
          </div>
        </div>
        {#key channel.id}<Composer channelName={channel.name} {send} {replyTo} local={!live} statusLabel={live ? (connectionStatus === 'online' ? `Conectado a ${instanceName} · historial persistente` : 'Reconectando con la instancia…') : 'Demo local · los mensajes se borran al recargar'} cancelReply={() => replyTo = null} />{/key}
      {/if}
    </main>
    {#if membersVisible}
      <aside class="members-sidebar" aria-label={live ? 'Miembros' : 'Miembros de demostración'}>
        <div class="members-heading"><span>LA COMUNIDAD</span><span>{members.length}</span><button class="icon-button members-close" aria-label="Cerrar miembros" onclick={() => membersVisible = false}><Icon name="close" size={16} /></button></div>
        <div class="member-group"><h2>{#if !live}<span class="status-dot"></span>{/if} {live ? 'MIEMBROS' : 'EN LÍNEA'} <span>— {online.length}</span></h2>{#each online as member}<button class="member-button" onclick={() => profile = member}><Avatar {member} size={33} presence={!live} /><span><strong>{member.name}{#if member.id === me.id}<span class="you-label">tú</span>{/if}</strong><small>{member.role === 'owner' ? 'Propietario' : member.role === 'member' ? 'Miembro' : member.role}</small></span></button>{/each}</div>
        {#if !live}<div class="member-group offline-group"><h2>DESCONECTADOS <span>— {offline.length}</span></h2>{#each offline as member}<button class="member-button" onclick={() => profile = member}><Avatar {member} size={33} presence /><span><strong>{member.name}</strong><small>{member.role}</small></span></button>{/each}</div>{/if}
        <div class="members-bottom"><div class="open-source-mark"><Icon name="code" size={22} /></div><h3>Tu equipo.<br />Tu servidor.</h3><p>{live ? instanceName : 'Una forma más libre de estar en comunidad.'}</p><button class="text-button" onclick={() => openModal('about')}>Conoce nu.vex <Icon name="arrow" size={14} /></button>{#if !live}<span class="members-demo-note">Perfiles y presencias de ejemplo</span>{/if}</div>
      </aside>
    {/if}
  </div>
  <div class="toast-region" aria-live="polite" aria-atomic="true">{#if notice}<div class="toast"><Icon name="check" size={17} /><span>{notice}</span><button class="icon-button" aria-label="Cerrar aviso" onclick={() => notice = ''}><Icon name="close" size={15} /></button></div>{/if}</div>

  {#if modal === 'appearance'}<Modal title="Apariencia" close={() => modal = null} wide><Appearance {preferences} change={changeTheme} /></Modal>
  {:else if modal === 'community'}
    <Modal title="Crea tu comunidad" close={() => modal = null}>
      <p class="modal-description">{live ? `Tu equipo y sus conversaciones, en ${instanceName}.` : 'Esta comunidad será temporal, solo en esta sesión de demostración.'}</p>
      <form class="creation-form" onsubmit={createCommunity} aria-busy={formPending}><label for="community-name">Nombre de la comunidad</label><input id="community-name" bind:value={formName} maxlength="48" placeholder="Por ejemplo, Mi equipo" required disabled={formPending} /><span class="field-hint">Puedes usar hasta 48 caracteres.</span>{#if formError}<p class="form-error" role="alert">{formError}</p>{/if}<button class="primary-button" type="submit" disabled={formPending}>{formPending ? 'Creando…' : live ? 'Crear comunidad' : 'Crear comunidad local'} <Icon name="arrow" size={16} /></button></form>
    </Modal>
  {:else if modal === 'channel'}
    <Modal title="Un nuevo canal" close={() => modal = null}><p class="modal-description">Un espacio de texto en {community.name}.{#if !live} Disponible durante esta sesión local.{/if}</p><form class="creation-form" onsubmit={createChannel} aria-busy={formPending}><label for="channel-name">Nombre del canal</label><input id="channel-name" bind:value={formName} maxlength="40" placeholder="un-nuevo-comienzo" required disabled={formPending} /><span class="field-hint">Letras, números y guiones. Sin duplicados.</span>{#if formError}<p class="form-error" role="alert">{formError}</p>{/if}<button class="primary-button" type="submit" disabled={formPending}>{formPending ? 'Creando…' : live ? 'Crear canal' : 'Crear canal local'} <Icon name="hash" size={16} /></button></form></Modal>
  {:else if modal === 'settings'}
    <Modal title="Tu nu.vex" close={() => modal = null}><div class="settings-profile"><Avatar member={me} size={48} /><div><strong>{me.name}</strong><span>{live ? `@${me.handle} · ${instanceName}` : 'Perfil de demostración · sin cuenta real'}</span></div></div><button class="settings-link" onclick={() => modal = 'appearance'}><Icon name="palette" /><span><strong>Apariencia</strong><small>Tema, cristal, colores y densidad</small></span><Icon name="arrow" size={17} /></button>
      {#if live}
        {#if manageInstances}<button class="settings-link" onclick={() => { modal = null; manageInstances?.(); }}><Icon name="globe" /><span><strong>Tus instancias</strong><small>{instances.length} {instances.length === 1 ? 'instancia guardada' : 'instancias guardadas'} · {isNative ? 'Elige otro servidor' : 'Cambia sin cerrar sesión'}</small></span><Icon name="arrow" size={17} /></button>{/if}
        <div class="future-setting"><Icon name="shield" /><span><strong>Cuenta de esta instancia</strong><small>{instanceUrl}</small></span></div><button class="settings-link danger" aria-label="Cerrar sesión" onclick={() => void actions?.logout()}><Icon name="logout" /><span><strong>Cerrar sesión</strong><small>Revoca solo la sesión en {instanceName}.</small></span><Icon name="arrow" size={17} /></button><p class="privacy-note">Las credenciales de sesión no se guardan en localStorage. El servidor controla el acceso a comunidades y mensajes.</p>
      {:else}<p class="privacy-note">Esta demo no solicita credenciales, micrófono ni cámara. Solo guarda tu apariencia en este navegador.</p><a class="secondary-button" href="/">Conectar con una instancia <Icon name="arrow" size={16} /></a>{/if}
    </Modal>
  {:else if modal === 'community-info'}
    <Modal title={community.name} close={() => modal = null}><p class="modal-description">{community.description}</p><div class="info-grid"><span><strong>{community.channels.filter((item) => item.kind === 'text').length}</strong> canales de texto</span><span><strong>{members.length}</strong> {live ? 'miembros visibles' : 'perfiles de ejemplo'}</span></div>{#if !live}<p class="privacy-note">Comunidad local de demostración. Los roles son etiquetas visuales; aún no existe un sistema de permisos.</p>{/if}<div class="modal-buttons"><button class="secondary-button" onclick={() => openModal('channel')}><Icon name="plus" size={16} /> {live ? 'Crear canal' : 'Crear canal local'}</button>{#if live}<button class="primary-button" onclick={() => openModal('invite')}>Invitar al equipo <Icon name="users" size={16} /></button>{:else}<button class="primary-button" onclick={() => modal = 'appearance'}>Personalizar <Icon name="palette" size={16} /></button>{/if}</div></Modal>
  {:else if modal === 'invite'}
    <Modal title="Invita a tu equipo" close={() => modal = null}><p class="modal-description">Comparte un código para que otra cuenta de {instanceName} se una a {community.name}. Solo el propietario puede crear invitaciones.</p>{#if inviteCode}<label class="setting-heading" for="invite-code">Código de invitación</label><input class="code-input" id="invite-code" value={inviteCode} readonly /><p class="privacy-note">Comparte este código únicamente con las personas a las que quieras dar acceso.</p>{:else}<button class="primary-button" disabled={formPending} onclick={() => void makeInvite()}>{formPending ? 'Generando…' : 'Generar invitación'}</button>{/if}{#if formError}<p class="form-error" role="alert">{formError}</p>{/if}</Modal>
  {:else if modal === 'join'}
    <Modal title="Únete a una comunidad" close={() => modal = null}><p class="modal-description">Introduce un código de invitación de esta instancia.</p><form class="creation-form" onsubmit={joinCommunity} aria-busy={formPending}><label for="join-code">Código de invitación</label><input id="join-code" bind:value={formName} maxlength="256" required disabled={formPending} /><button class="primary-button" disabled={formPending}>{formPending ? 'Uniéndote…' : 'Unirme a la comunidad'}</button>{#if formError}<p class="form-error" role="alert">{formError}</p>{/if}</form></Modal>
  {:else if modal === 'pins'}<Modal title="Mensajes fijados" close={() => modal = null}><div class="empty-state"><Icon name="pin" size={32} /><h3>Las ideas importantes tendrán su lugar.</h3><p>Fijar mensajes estará disponible con el sistema de permisos del servidor. Esta demo no contiene mensajes fijados.</p></div></Modal>
  {:else if modal === 'about'}<Modal title="Un espacio para conectar." close={() => modal = null}><div class="about-brand"><img src="/brand/logo-app.png" alt="Icono oficial de nu.vex" width="68" height="68" /><img src="/brand/logo-app.svg" alt="nu.vex" width="155" height="33" /></div><p class="modal-description">Comunicación independiente para comunidades y empresas. Cuentas, conversaciones y control de acceso en la instancia que elijas.</p><div class="milestone"><span class="tag">α 0.2 · PRE-RELEASE</span><h3>Creado por Pablo · ImPaul17</h3><p>Web y escritorio comparten el mismo cliente. Aloja un servidor propio o conéctate al de tu equipo.</p></div><p class="privacy-note">{live ? `Instancia: ${instanceName}` : 'Estás viendo datos de demostración.'} · Apache-2.0 · Geist bajo SIL OFL 1.1.</p><a class="secondary-button" href="https://github.com/ImPaul17/nu.vex" target="_blank" rel="noopener noreferrer">Proyecto y documentación <Icon name="arrow" size={16} /></a></Modal>{/if}
  {#if profile}<Modal title={live ? 'Perfil' : 'Perfil de demostración'} close={() => profile = null}><div class="profile-banner" style:--profile-color={profile.color}></div><div class="profile-details"><Avatar member={profile} size={68} presence /><h3>{profile.name}</h3><span class="profile-handle">@{profile.handle}</span><span class="profile-role">{profile.role}</span><h4>SOBRE MÍ</h4><p>{profile.bio}</p>{#if !live}<div class="privacy-note"><Icon name="users" size={15} /> Miembro ficticio de esta vista previa. Sin mensajería privada.</div>{/if}</div></Modal>{/if}
</div>
