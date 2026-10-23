<script lang="ts">
  import { onMount } from "svelte";
  import type { Channel, Community, Message } from "@nuvex/core";
  import ChatShell from "$lib/features/ChatShell.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import {
    ApiError,
    InstanceApi,
    decodeEvent,
    normalizeInstance,
    type InstanceInfo,
  } from "$lib/services/api";
  import { isNative, type EventSocket } from "$lib/services/native";
  import type { ConnectionStatus, WorkspaceActions, WorkspaceSnapshot } from "$lib/services/types";

  // Estado de la UI
  let stage = $state<"loading" | "connect" | "login" | "register">("loading");
  let instanceAddress = $state("");
  let instance = $state<InstanceInfo | null>(null);
  let snapshot = $state<WorkspaceSnapshot | null>(null);
  let connectionStatus = $state<ConnectionStatus>("offline");
  let error = $state("");
  let busy = $state(false);

  // Formularios
  let email = $state("");
  let password = $state("");
  let displayName = $state("");
  let handle = $state("");
  let communityName = $state("");
  let invitation = $state("");
  let onboardingTab = $state<"create" | "join">("create");

  // Instancias guardadas (multi-instancia)
  type SavedInstance = { url: string; name: string; lastUsedAt: number };
  let savedInstances = $state<SavedInstance[]>([]);

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
      instanceAddress = normalizeInstance(
        localStorage.getItem("nuvex:last-instance") ?? (isNative ? "" : window.location.origin),
      );
    } catch {
      instanceAddress = isNative ? "" : window.location.origin;
    }

    // Cargar lista de instancias guardadas
    try {
      const stored = JSON.parse(localStorage.getItem("nuvex:instances:v1") ?? "[]");
      if (Array.isArray(stored)) {
        savedInstances = stored
          .filter(
            (item): item is SavedInstance =>
              Boolean(item && typeof item.url === "string" && typeof item.name === "string"),
          )
          .slice(0, 6);
      }
    } catch {
      savedInstances = [];
    }

    if (instanceAddress) void connect(true);
    else stage = "connect";

    return () => {
      closed = true;
      stopSocket();
      void api?.dispose().catch(() => {});
    };
  });

  function stopSocket() {
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
    const next = [
      { url, name: details.name || "Instancia nu.vex", lastUsedAt: Date.now() },
      ...savedInstances.filter((item) => item.url !== url),
    ].slice(0, 6);
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
    } catch {
      /* No bloquea el cambio de instancia. */
    }
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
    try {
      candidate = new InstanceApi(instanceAddress);
      await api?.dispose();
      api = null;
      const details = await candidate.instance();
      if (epoch !== sessionEpoch || closed) {
        await candidate.dispose();
        return;
      }
      api = candidate;
      instance = details;
      instanceAddress = candidate.baseUrl;
      rememberInstance(details, candidate.baseUrl);
      try {
        localStorage.setItem("nuvex:last-instance", instanceAddress);
      } catch {
        /* Connecting still works without browser storage. */
      }
      stage = "login";
      if (restore && !candidate.crossOrigin) {
        try {
          await enterWorkspace();
        } catch (cause) {
          if (!(cause instanceof ApiError && cause.status === 401)) throw cause;
        }
      }
    } catch (cause) {
      await candidate?.dispose().catch(() => {});
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
      if (generation !== socketGeneration || closed || !snapshot) {
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
        if (generation === socketGeneration) scheduleReconnect();
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
    async createChannel(id, name) {
      const created = await withSession((connection) => connection.createChannel(id, name));
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
  <ChatShell {snapshot} {actions} {connectionStatus} instanceName={instance?.name ?? "nu.vex"} instanceUrl={instanceAddress} />
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
      <section class="entry-intro" aria-hidden={stage !== "connect"}>
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
          <div class="entry-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={onboardingTab === "create"}
              class:active={onboardingTab === "create"}
              onclick={() => {
                onboardingTab = "create";
                error = "";
              }}
            >
              Crear comunidad
            </button>
            <button
              role="tab"
              aria-selected={onboardingTab === "join"}
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
            Conecta con la comunidad central de nu.vex o con una instancia de tu equipo.
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
                    onclick={() => { instanceAddress = saved.url; void connect(); }}
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
            <button class="text-button" onclick={() => { password = ""; error = ""; stage = "connect"; }}>Cambiar</button>
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