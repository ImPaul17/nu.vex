<script lang="ts">
  import { onMount } from "svelte";
  import type { Channel, Community, Message } from "@nuvex/core";
  import ChatShell from "$lib/features/ChatShell.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import { parseSavedInstances, rememberInstance as addSavedInstance, type SavedInstance } from '@nuvex/core';
  import {
    ApiError,
    InstanceApi,
    decodeEvent,
    normalizeInstance,
    type InstanceInfo,
  } from "$lib/services/api";
  import { isNative, type EventSocket } from "$lib/services/native";
  import type { ConnectionStatus, WorkspaceActions, WorkspaceSnapshot } from "$lib/services/types";
  import { VoiceSession, decodeVoiceEvent, emptyVoiceState } from '$lib/services/voice';

  // Estado de la UI
  let stage = $state<"loading" | "connect" | "login" | "register">("loading");
  let instanceAddress = $state("");
  let instance = $state<InstanceInfo | null>(null);
  let snapshot = $state<WorkspaceSnapshot | null>(null);
  let connectionStatus = $state<ConnectionStatus>("offline");
  let error = $state("");
  let busy = $state(false);
  let voice = $state(emptyVoiceState());
  let voiceSession: VoiceSession | null = null;

  function leaveVoice(reason = '') { voiceSession?.leave(reason); voiceSession = null; if (!reason) voice = emptyVoiceState(); }
  async function joinVoice(channel: Channel) {
    if (!api || !snapshot || connectionStatus !== 'online') return;
    leaveVoice();
    const session = new VoiceSession(api, channel.id, channel.name, (next) => { if (voiceSession === session) voice = next; });
    voiceSession = session;
    await session.join();
  }

  // Formularios
  let email = $state("");
  let password = $state("");
  let displayName = $state("");
  let handle = $state("");
  let communityName = $state("");
  let invitation = $state("");
  let onboardingTab = $state<"create" | "join">("create");

  // Instancias guardadas (multi-instancia)
  let savedInstances = $state<SavedInstance[]>([]);
  let instancesOpen = $state(false);
  let nextInstanceAddress = $state('');
  let connectedAccounts = $state<Record<string, string>>({});
  const sessions = new Map<string, { connection: InstanceApi; details: InstanceInfo }>();
  const instanceChoices = $derived(savedInstances.map((item) => ({ ...item, account: connectedAccounts[item.url] })));

  // Internos
  let api = $state<InstanceApi | null>(null);
  let socket: EventSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let retryAttempt = 0;
  let activeChannelId: string | null = null;
  let channelRequest = 0;
  let closed = false;
  let socketGeneration = 0;
  let sessionEpoch = 0;
  let workspaceRequest = 0;
  let needsResync = false;
  const deletedMessageIds = new Set<string>();

  const message = (cause: unknown) =>
    cause instanceof Error ? cause.message : "No se pudo completar la operación.";

  // Cargar instancias guardadas al montar
  onMount(() => {
    try {
      const fallback = import.meta.env.VITE_NUVEX_DEFAULT_INSTANCE || (isNative || import.meta.env.VITE_NUVEX_CLIENT_ONLY === 'true' ? '' : window.location.origin);
      const address = localStorage.getItem('nuvex:last-instance') || fallback;
      instanceAddress = address ? normalizeInstance(address) : '';
    } catch {
      instanceAddress = '';
    }

    // Cargar lista de instancias guardadas
    try {
      savedInstances = parseSavedInstances(localStorage.getItem("nuvex:instances:v1") ?? '[]');
    } catch {
      savedInstances = [];
    }

    if (instanceAddress) void connect(true);
    else stage = "connect";

    return () => {
      closed = true;
      stopSocket();
      for (const session of sessions.values()) void session.connection.dispose().catch(() => {});
    };
  });

  function stopSocket() {
    leaveVoice();
    socketGeneration++;
    clearTimeout(reconnectTimer);
    const previous = socket;
    socket = null;
    if (previous) {
      previous.onclose = null;
      previous.close();
    }
    connectionStatus = "offline";
  }

  function current(epoch: number, connection: InstanceApi) {
    return !closed && epoch === sessionEpoch && api === connection;
  }

  function assertCurrent(epoch: number, connection: InstanceApi) {
    if (!current(epoch, connection)) throw new ApiError("La sesión ha cambiado.", 409, "stale_session");
  }

  function forgetSession() {
    if (api) { const accounts = { ...connectedAccounts }; delete accounts[api.baseUrl]; connectedAccounts = accounts; }
    sessionEpoch++;
    channelRequest++;
    workspaceRequest++;
    needsResync = false;
    stopSocket();
    snapshot = null;
    activeChannelId = null;
    deletedMessageIds.clear();
    password = "";
    stage = "login";
  }

  function sessionFailure(cause: unknown, epoch = sessionEpoch): never {
    if (epoch === sessionEpoch && cause instanceof ApiError && cause.status === 401) {
      forgetSession();
      error = "Tu sesión ha caducado. Inicia sesión de nuevo.";
    }
    throw cause;
  }

  function rememberInstance(details: InstanceInfo, address: string) {
    const url = normalizeInstance(address);
    const next = addSavedInstance(savedInstances, { url, name: details.name || 'Instancia nu.vex' });
    savedInstances = next;
    try {
      localStorage.setItem("nuvex:instances:v1", JSON.stringify(next));
    } catch {
      /* La conexión funciona aunque no se pueda guardar la lista. */
    }
  }

  function forgetInstance(url: string) {
    savedInstances = savedInstances.filter((item) => item.url !== url);
    try {
      localStorage.setItem("nuvex:instances:v1", JSON.stringify(savedInstances));
      if (localStorage.getItem('nuvex:last-instance') === url) localStorage.removeItem('nuvex:last-instance');
    } catch {
      /* No bloquea el cambio de instancia. */
    }
  }

  async function switchInstance(address: string) {
    if (busy) return;
    instancesOpen = false;
    if (api?.baseUrl === address && snapshot) return;
    instanceAddress = address;
    await connect(true);
  }

  async function withSession<T>(operation: (connection: InstanceApi) => Promise<T>): Promise<T> {
    if (!api) throw new Error("No hay una instancia conectada.");
    const connection = api;
    const epoch = sessionEpoch;
    try {
      const result = await operation(connection);
      assertCurrent(epoch, connection);
      return result;
    } catch (cause) {
      sessionFailure(cause, epoch);
    }
  }

  async function connect(restore = false) {
    if (busy) return;
    busy = true;
    error = "";
    stopSocket();
    const epoch = ++sessionEpoch;
    let candidate: InstanceApi | null = null;
    snapshot = null;
    activeChannelId = null;
    deletedMessageIds.clear();
    password = ''; email = '';
    stage = 'loading';
    instance = null;
    try {
      const url = normalizeInstance(instanceAddress);
      // El mediador nativo permite una conexión por ventana: no reutilizar handles invalidados.
      if (isNative) {
        for (const session of sessions.values()) await session.connection.dispose().catch(() => {});
        sessions.clear();
        connectedAccounts = {};
      }
      candidate = sessions.get(url)?.connection ?? new InstanceApi(url);
      api = null;
      const details = await candidate.instance();
      if (epoch !== sessionEpoch || closed) {
        await candidate.dispose();
        return;
      }
      api = candidate;
      instance = details;
      instanceAddress = candidate.baseUrl;
      sessions.delete(candidate.baseUrl);
      sessions.set(candidate.baseUrl, { connection: candidate, details });
      while (sessions.size > 6) {
        const oldest = sessions.keys().next().value!;
        await sessions.get(oldest)?.connection.dispose().catch(() => {});
        sessions.delete(oldest);
        const accounts = { ...connectedAccounts }; delete accounts[oldest]; connectedAccounts = accounts;
      }
      rememberInstance(details, candidate.baseUrl);
      try {
        localStorage.setItem("nuvex:last-instance", instanceAddress);
      } catch {
        /* Connecting still works without browser storage. */
      }
      if (restore && (!candidate.crossOrigin || connectedAccounts[candidate.baseUrl])) {
        try {
          await enterWorkspace();
        } catch (cause) {
          if (cause instanceof ApiError && cause.status === 401) forgetSession();
          else throw cause;
        }
      }
      // No permitir elegir registro mientras un 401 de restauración aún puede cambiar la vista.
      stage = "login";
    } catch (cause) {
      if (candidate && !sessions.has(candidate.baseUrl)) await candidate.dispose().catch(() => {});
      snapshot = null;
      api = null;
      instance = null;
      stage = "connect";
      error = message(cause);
    } finally {
      busy = false;
    }
  }

  async function authenticate(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !api) return;
    busy = true;
    error = "";
    const connection = api;
    const epoch = ++sessionEpoch;
    try {
      await connection.authenticate(stage === "register" ? "register" : "login", {
        email: email.trim(),
        password,
        displayName: displayName.trim(),
        handle: handle.trim(),
      });
      assertCurrent(epoch, connection);
      deletedMessageIds.clear();
      password = "";
      await enterWorkspace();
    } catch (cause) {
      error = message(cause);
    } finally {
      busy = false;
    }
  }

  function mergeMessage(item: Message) {
    if (
      !snapshot ||
      deletedMessageIds.has(item.id) ||
      !snapshot.communities.some((community) =>
        community.channels.some((channel) => channel.id === item.channelId),
      )
    )
      return;
    snapshot = {
      ...snapshot,
      messages: [
        ...snapshot.messages.filter((current) => current.id !== item.id),
        item,
      ].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    };
  }

  async function loadChannel(channel: Channel, reset = false) {
    if (!api || !snapshot || channel.kind !== "text") return;
    const connection = api;
    const epoch = sessionEpoch;
    activeChannelId = channel.id;
    const request = ++channelRequest;
    const existingIds = new Set(
      snapshot.messages.filter((item) => item.channelId === channel.id).map((item) => item.id),
    );
    try {
      const history = await connection.messages(channel.id);
      if (
        !current(epoch, connection) ||
        request !== channelRequest ||
        !snapshot ||
        !snapshot.communities.some((community) => community.channels.some((item) => item.id === channel.id))
      )
        return;
      const liveArrivals = snapshot.messages.filter(
        (item) => item.channelId === channel.id && !existingIds.has(item.id),
      );
      const cached = reset ? [] : snapshot.messages.filter((item) => item.channelId === channel.id);
      const byId = new Map(
        [...cached, ...history, ...liveArrivals]
          .filter((item) => !deletedMessageIds.has(item.id))
          .map((item) => [item.id, item]),
      );
      snapshot = {
        ...snapshot,
        messages: [
          ...snapshot.messages.filter((item) => item.channelId !== channel.id),
          ...byId.values(),
        ].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
      };
    } catch (cause) {
      sessionFailure(cause, epoch);
    }
  }

  async function refreshWorkspace(resync = false) {
    if (!api || !snapshot) return;
    const connection = api;
    const epoch = sessionEpoch;
    if (resync) needsResync = true;
    const request = ++workspaceRequest;
    try {
      const fresh = await connection.bootstrap();
      if (!current(epoch, connection) || !snapshot || request !== workspaceRequest) return;
      const reset = needsResync;
      needsResync = false;
      const allowedChannels = new Set(
        fresh.communities.flatMap((community) => community.channels.map((channel) => channel.id)),
      );
      if (voice.channelId && !allowedChannels.has(voice.channelId)) leaveVoice('Ya no tienes acceso a este canal de voz.');
      snapshot = {
        ...fresh,
        historyGeneration: (snapshot.historyGeneration ?? 0) + (reset ? 1 : 0),
        messages: reset
          ? []
          : snapshot.messages.filter((item) => allowedChannels.has(item.channelId)),
      };
      if (activeChannelId && !allowedChannels.has(activeChannelId)) activeChannelId = null;
      const active =
        fresh.communities.flatMap((community) => community.channels).find(
          (channel) => channel.id === activeChannelId,
        ) ?? fresh.communities[0]?.channels[0];
      if (active) await loadChannel(active, reset);
    } catch (cause) {
      sessionFailure(cause, epoch);
    }
  }

  async function enterWorkspace() {
    if (!api) return;
    const connection = api;
    const epoch = sessionEpoch;
    const fresh = await connection.bootstrap();
    assertCurrent(epoch, connection);
    snapshot = fresh;
    connectedAccounts = { ...connectedAccounts, [connection.baseUrl]: fresh.user.name };
    const first = snapshot.communities[0]?.channels.find((channel) => channel.kind === "text");
    if (first) await loadChannel(first);
    retryAttempt = 0;
    await connectEvents();
  }

  async function connectEvents() {
    if (!api || !snapshot || closed) return;
    const connection = api;
    const epoch = sessionEpoch;
    const generation = ++socketGeneration;
    connectionStatus = retryAttempt ? "reconnecting" : "connecting";
    try {
      const pending = await connection.eventSocket();
      if (generation !== socketGeneration || !current(epoch, connection) || !snapshot) {
        pending.close();
        return;
      }
      socket = pending;
      const reconcile = (resync = false) => {
        void refreshWorkspace(resync).then(() => {
          if (current(epoch, connection) && generation === socketGeneration) {
            connectionStatus = "online";
            retryAttempt = 0;
          }
        }).catch((cause) => {
          if (!current(epoch, connection) || generation !== socketGeneration) return;
          error = message(cause);
          pending.close();
        });
      };
      pending.onopen = () => {
        if (generation !== socketGeneration) return;
        reconcile(true);
      };
      pending.onmessage = (event) => {
        if (
          generation !== socketGeneration ||
          typeof event.data !== "string" ||
          event.data.length > 64_000
        )
          return;
        let payload: unknown;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        const incoming = decodeEvent(payload);
        const voiceEvent = decodeVoiceEvent(payload);
        if (voiceEvent) { voiceSession?.event(voiceEvent); return; }
        if (!incoming || !snapshot) return;
        if (incoming.type === "message.created") {
          const known = snapshot.communities.some((community) =>
            community.channels.some((channel) => channel.id === incoming.message.channelId),
          );
          if (known) mergeMessage(incoming.message);
          if (!snapshot.members.some((member) => member.id === incoming.message.authorId)) reconcile();
        } else if (incoming.type === "message.deleted") {
          deletedMessageIds.add(incoming.messageId);
          snapshot = {
            ...snapshot,
            messages: snapshot.messages.filter((item) => item.id !== incoming.messageId),
          };
        } else reconcile(incoming.type === "resync.required");
      };
      pending.onclose = () => {
        if (generation === socketGeneration) { leaveVoice('La conexión con la instancia se ha interrumpido. Vuelve a unirte al canal cuando se reconecte.'); scheduleReconnect(); }
      };
      pending.onerror = () => pending.close();
    } catch (cause) {
      if (!current(epoch, connection) || generation !== socketGeneration) return;
      if (cause instanceof ApiError && cause.status === 401) {
        forgetSession();
        error = "Tu sesión ha caducado.";
        return;
      }
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (closed || !snapshot) return;
    connectionStatus = "reconnecting";
    clearTimeout(reconnectTimer);
    const delay = Math.min(1000 * 2 ** retryAttempt++, 20_000) + Math.floor(Math.random() * 300);
    reconnectTimer = setTimeout(() => void connectEvents(), delay);
  }

  const actions: WorkspaceActions = {
    selectChannel: loadChannel,
    async loadEarlier(channelId, before) {
      if (!api || !snapshot) return 0;
      const historyGeneration = snapshot.historyGeneration ?? 0;
      const earlier = await withSession((connection) => connection.messages(channelId, before));
      if (
        (snapshot?.historyGeneration ?? 0) !== historyGeneration ||
        !snapshot?.communities.some((community) => community.channels.some((channel) => channel.id === channelId))
      )
        return 0;
      if (snapshot) {
        const byId = new Map(
          [...earlier, ...snapshot.messages]
            .filter((item) => !deletedMessageIds.has(item.id))
            .map((item) => [item.id, item]),
        );
        snapshot = {
          ...snapshot,
          messages: [...byId.values()].sort(
            (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
          ),
        };
      }
      return earlier.length;
    },
    async send(channelId, content) {
      if (!api) throw new Error("No hay una instancia conectada.");
      const connection = api;
      const epoch = sessionEpoch;
      const clientId = crypto.randomUUID();
      try {
        let sent: Message;
        try {
          sent = await connection.send(channelId, content, clientId);
        } catch (cause) {
          assertCurrent(epoch, connection);
          if (!(cause instanceof ApiError) || cause.status !== 0) throw cause;
          sent = await connection.send(channelId, content, clientId);
        }
        assertCurrent(epoch, connection);
        mergeMessage(sent);
      } catch (cause) {
        sessionFailure(cause, epoch);
      }
    },
    async createCommunity(name) {
      const created = await withSession((connection) => connection.createCommunity(name));
      await refreshWorkspace();
      return created;
    },
    async createChannel(id, name, kind) {
      const created = await withSession((connection) => connection.createChannel(id, name, kind));
      await refreshWorkspace();
      return created;
    },
    createInvite: (id) => withSession((connection) => connection.createInvite(id)),
    async joinInvite(code) {
      await withSession((connection) => connection.joinInvite(code));
      await refreshWorkspace();
    },
    async deleteMessage(item) {
      await withSession((connection) => connection.deleteMessage(item));
      deletedMessageIds.add(item.id);
      if (snapshot) snapshot = { ...snapshot, messages: snapshot.messages.filter((current) => current.id !== item.id) };
    },
    async logout() {
      leaveVoice();
      const connection = api;
      const epoch = sessionEpoch;
      try {
        if (connection) await connection.logout();
        if (epoch === sessionEpoch) forgetSession();
      } catch (cause) {
        if (epoch === sessionEpoch) error = `No se pudo revocar la sesión: ${message(cause)}`;
      }
    },
  };

  async function startCommunity(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    error = "";
    try {
      if (onboardingTab === "create") await actions.createCommunity(communityName.trim());
      else await actions.joinInvite(invitation.trim());
    } catch (cause) {
      error = message(cause);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>{snapshot ? "nu.vex" : "Conecta con tu equipo — nu.vex"}</title>
  <meta name="description" content="nu.vex — Comunicación independiente para tu equipo. Tu servidor, tus reglas." />
</svelte:head>

{#if snapshot && snapshot.communities.length > 0}
  {#key instanceAddress}<ChatShell {snapshot} {actions} {connectionStatus} {voice} joinVoice={joinVoice} leaveVoice={() => leaveVoice()} muteVoice={() => voiceSession?.toggleMuted()} deafenVoice={() => voiceSession?.toggleDeafened()} voiceInput={(id) => voiceSession?.setInput(id)} voiceOutput={(id) => voiceSession?.setOutput(id)} voiceVolume={(value) => voiceSession?.setVolume(value)} resumeVoice={() => voiceSession?.resumeAudio()} voicePeerMute={(id) => voiceSession?.togglePeerMuted(id)} voicePeerVolume={(id, value) => voiceSession?.setPeerVolume(id, value)} instanceName={instance?.name ?? "nu.vex"} instanceUrl={instanceAddress} instances={instanceChoices} switchInstance={switchInstance} manageInstances={() => { error = ''; instancesOpen = true; }} />{/key}
  {#if error}
    <div class="session-alert" role="alert">
      {error}
      <button aria-label="Cerrar aviso" onclick={() => (error = "")}>
        <Icon name="close" size={16} />
      </button>
    </div>
  {/if}
{:else}
  <div class="entry-page" data-theme="emerald">
    <header class="entry-header">
      <img src="/brand/logo-app.svg" alt="nu.vex" width="120" height="25" />
      <span>Tu equipo. Tu servidor.</span>
      <a href="/demo" class="demo-link">Explorar demo <Icon name="arrow" size={14} /></a>
    </header>

    <main class="entry-main">
      <section class="entry-intro">
        <div class="entry-brand">
          <img src="/brand/logo-app.png" alt="" width="80" height="80" />
        </div>
        <span class="eyebrow">COMUNICACIÓN INDEPENDIENTE</span>
        <h1>El punto de encuentro<br />de tu equipo<span>.</span></h1>
        <p>Conversaciones en tiempo real.<br />Un servidor que tú eliges. Un espacio propio.</p>
        <div class="entry-features">
          <span><Icon name="globe" size={17} /> En tu infraestructura</span>
          <span><Icon name="shield" size={17} /> Cuentas por instancia</span>
          <span><Icon name="code" size={17} /> Código abierto</span>
        </div>
        <div class="entry-detail"><span class="status-dot" aria-hidden="true"></span> Para comunidades, equipos y empresas.</div>
      </section>

      <section class="entry-card" aria-label={snapshot ? "Crear o unirse a una comunidad" : "Acceso a nu.vex"} aria-busy={busy}>
        {#if snapshot}
          <!-- Onboarding: primera comunidad -->
          <span class="eyebrow">HOLA, {snapshot.user.name.toLocaleUpperCase("es")}</span>
          <h2>Tu primer espacio.</h2>
          <p class="entry-description">
            Ya tienes una cuenta en <strong>{instance?.name}</strong>. Crea una comunidad o únete a tu equipo.
          </p>
          <div class="entry-tabs" role="group" aria-label="Tu primera comunidad">
            <button
              aria-pressed={onboardingTab === "create"}
              class:active={onboardingTab === "create"}
              onclick={() => {
                onboardingTab = "create";
                error = "";
              }}
            >
              Crear comunidad
            </button>
            <button
              aria-pressed={onboardingTab === "join"}
              class:active={onboardingTab === "join"}
              onclick={() => {
                onboardingTab = "join";
                error = "";
              }}
            >
              Tengo una invitación
            </button>
          </div>
          <form class="entry-form" onsubmit={startCommunity}>
            {#if onboardingTab === "create"}
              <label for="first-community">Nombre de la comunidad</label>
              <input
                id="first-community"
                bind:value={communityName}
                maxlength="48"
                required
                placeholder="Mi equipo"
                disabled={busy}
              />
            {:else}
              <label for="first-invite">Código de invitación</label>
              <input
                id="first-invite"
                bind:value={invitation}
                maxlength="256"
                required
                placeholder="El código que te ha compartido tu equipo"
                disabled={busy}
              />
            {/if}
            <button class="primary-button" type="submit" disabled={busy}>
              {busy
                ? "Conectando…"
                : onboardingTab === "create"
                ? "Crear comunidad"
                : "Unirme a la comunidad"}
              <Icon name="arrow" size={17} />
            </button>
          </form>
          <button class="text-button" onclick={() => void actions.logout()}>Cerrar sesión</button>

        {:else if stage === "loading"}
          <span class="eyebrow" style="text-transform: none">nu.vex</span>
          <h2>Buscando tu instancia…</h2>
          <p class="entry-description">Comprobando el servidor y tu sesión.</p>

        {:else if stage === "connect"}
          <!-- Selector de instancia mejorado -->
          <span class="eyebrow">¿DÓNDE CONECTAR?</span>
          <h2>Un servidor. Tu gente.</h2>
          <p class="entry-description">
            Conecta con una instancia de tu comunidad o equipo.
            Puedes guardar hasta seis espacios y cambiar entre ellos cuando quieras.
          </p>

          <form class="entry-form" onsubmit={(event) => { event.preventDefault(); void connect(); }}>
            <label for="instance-url">Dirección de la instancia</label>
            <div class="url-input-wrapper">
              <span class="url-icon"><Icon name="globe" size={18} /></span>
              <input
                id="instance-url"
                type="url"
                bind:value={instanceAddress}
                placeholder="https://chat.tuempresa.com"
                required
                disabled={busy}
                spellcheck="false"
                autocomplete="url"
              />
            </div>
            <span class="field-hint">Usa el origen completo (https://...). La instancia debe ejecutar un servidor nu.vex compatible.</span>
            <button class="primary-button" type="submit" disabled={busy}>
              {busy ? "Comprobando…" : "Conectar a la instancia"} <Icon name="arrow" size={17} />
            </button>
          </form>

          {#if savedInstances.length > 0}
            <section class="saved-instances" aria-label="Tus instancias guardadas">
              <div class="saved-instances-heading">
                <span>TUS INSTANCIAS</span>
                <small>{savedInstances.length}/6 guardadas en este dispositivo</small>
              </div>
              {#each savedInstances as saved (saved.url)}
                <div class="saved-instance">
                  <button
                    class="saved-instance-button"
                    type="button"
                    onclick={() => void switchInstance(saved.url)}
                    disabled={busy}
                  >
                    <span class="saved-instance-icon"><Icon name="globe" size={16} /></span>
                    <span>
                      <strong>{saved.name}</strong>
                      <small>{saved.url}</small>
                    </span>
                    <Icon name="arrow" size={15} />
                  </button>
                  <button
                    class="saved-instance-remove"
                    type="button"
                    aria-label={`Quitar ${saved.name}`}
                    title="Quitar de este dispositivo"
                    onclick={() => forgetInstance(saved.url)}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              {/each}
              <p class="privacy-note">Solo guardamos el nombre y la dirección. Las sesiones y contraseñas siguen bajo el control de cada instancia.</p>
            </section>
          {:else}
            <p class="connect-note">
              <Icon name="shield" size={14} />
              La primera conexión se guardará para que puedas volver sin escribir la dirección.
            </p>
          {/if}

        {:else}
          <!-- Login / Registro -->
          <div class="instance-chip">
            <Icon name="globe" size={17} />
            <span>
              <strong>{instance?.name}</strong>
              <small>{instanceAddress}</small>
            </span>
            <button class="text-button" disabled={busy} onclick={() => { password = ""; error = ""; stage = "connect"; }}>Cambiar</button>
          </div>

          <h2>{stage === "register" ? "Tu cuenta, en tu servidor." : "De vuelta con tu equipo."}</h2>
          <p class="entry-description">
            {stage === "register"
              ? "Esta cuenta pertenece a la instancia seleccionada."
              : "Inicia sesión con tu cuenta de esta instancia."}
          </p>

          <form class="entry-form" onsubmit={authenticate}>
            {#if stage === "register"}
              <label for="display-name">Nombre visible</label>
              <input
                id="display-name"
                bind:value={displayName}
                maxlength="48"
                autocomplete="nickname"
                required
                disabled={busy}
                placeholder="Tu nombre"
              />
              <label for="handle">Nombre de usuario</label>
              <input
                id="handle"
                bind:value={handle}
                minlength="3"
                maxlength="32"
                autocomplete="username"
                required
                disabled={busy}
                placeholder="usuario"
              />
              <span class="field-hint">3–32 letras, números o guiones bajos.</span>
            {/if}

            <label for="email">Correo electrónico</label>
            <input
              id="email"
              type="email"
              bind:value={email}
              maxlength="254"
              autocomplete={stage === "register" ? "email" : "username"}
              required
              disabled={busy}
              placeholder="tu@email.com"
            />

            <label for="password">Contraseña</label>
            <input
              id="password"
              type="password"
              bind:value={password}
              minlength={stage === "register" ? 12 : 1}
              maxlength="128"
              autocomplete={stage === "register" ? "new-password" : "current-password"}
              required
              disabled={busy}
              placeholder={stage === "register" ? "Mínimo 12 caracteres" : "Tu contraseña"}
            />
            {#if stage === "register"}
              <span class="field-hint">Al menos 12 caracteres. No reutilices una contraseña.</span>
            {/if}

            <button class="primary-button" type="submit" disabled={busy}>
              {busy ? "Conectando…" : stage === "register" ? "Crear cuenta" : "Iniciar sesión"} <Icon name="arrow" size={17} />
            </button>
          </form>

          {#if instance?.registrationOpen}
            <p class="entry-switch">
              {stage === "register" ? "¿Ya tienes cuenta?" : "¿Primera vez aquí?"}
              <button onclick={() => { stage = stage === "register" ? "login" : "register"; error = ""; password = ""; }}>
                {stage === "register" ? "Iniciar sesión" : "Crear una cuenta"}
              </button>
            </p>
          {:else}
            <p class="privacy-note">El registro está cerrado. Contacta con quien administra esta instancia.</p>
          {/if}

          {#if api?.crossOrigin}
            <p class="privacy-note">
              {isNative ? "La sesión se guarda en la memoria de la aplicación." : "Acceso a una instancia externa. La sesión se conserva en memoria."}
              Tendrás que iniciar sesión otra vez si recargas.
            </p>
          {/if}
        {/if}

        {#if error}
          <p class="entry-error" role="alert">{error}</p>
        {/if}
      </section>
    </main>

    <footer class="entry-footer">
      <span>nu.vex · comunicación bajo tu control</span>
      <span>Apache-2.0 · Geist OFL 1.1</span>
      <span class="creator-attribution">Creado por <a href="https://github.com/ImPaul17" target="_blank" rel="noopener">Pablo</a></span>
    </footer>
  </div>
{/if}

{#if instancesOpen}
  <Modal title="Tus instancias" close={() => instancesOpen = false}>
    <p class="modal-description">Tu comunidad, tu equipo o tu servidor personal. Cada instancia tiene sus propias cuentas y conversaciones.</p>
    <div class="instance-options">
      {#each instanceChoices as choice (choice.url)}
        <button class="instance-option" class:current={choice.url === instanceAddress} onclick={() => void switchInstance(choice.url)}>
          <span class="instance-avatar"><Icon name="globe" size={21} /></span>
          <span><strong>{choice.name}</strong><small>{choice.account ? `Sesión de ${choice.account}` : choice.url}</small></span>
          {#if choice.url === instanceAddress}<Icon name="check" size={18} />{:else}<Icon name="arrow" size={18} />{/if}
        </button>
      {/each}
    </div>
    <form class="creation-form instance-add-form" onsubmit={(event) => { event.preventDefault(); void switchInstance(nextInstanceAddress); }}>
      <label for="next-instance">Añadir otra instancia</label>
      <input id="next-instance" type="url" bind:value={nextInstanceAddress} placeholder="https://chat.tucomunidad.com" required spellcheck="false" />
      <button class="primary-button" type="submit">Conectar <Icon name="arrow" size={16} /></button>
    </form>
    <p class="privacy-note">{isNative ? 'En escritorio, cambiar de instancia requiere iniciar sesión de nuevo. El transporte nativo mantiene una conexión por ventana.' : 'Las sesiones se mantienen en memoria mientras esta pestaña siga abierta. Cerrar sesión revoca solo la cuenta de la instancia actual.'}</p>
  </Modal>
{/if}
