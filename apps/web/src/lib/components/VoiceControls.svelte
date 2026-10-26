<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import type { VoiceState } from '$lib/services/voice';
  let { voice, leave, mute, deafen, input, output, volume, resume }: {
    voice: VoiceState; leave: () => void; mute: () => unknown; deafen: () => unknown;
    input: (id: string) => unknown; output: (id: string) => unknown; volume: (value: number) => void; resume: () => unknown;
  } = $props();
  const canChooseOutput = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
</script>

<section class="voice-bar" aria-label="Conexión de voz">
  <div class="voice-bar-label"><Icon name="volume" size={19} /><span><strong>{voice.channelName}</strong><small role="status">{voice.status === 'joining' ? 'Autorizando micrófono…' : voice.status === 'connected' ? 'Voz conectada' : 'Conectando audio…'}</small></span></div>
  <div class="voice-bar-actions">
    <button class="icon-button" class:voice-muted={voice.muted || voice.deafened} disabled={!voice.participantId || voice.deafened} aria-label={voice.muted ? 'Activar micrófono' : 'Silenciar micrófono'} aria-pressed={voice.muted || voice.deafened} title={voice.muted || voice.deafened ? 'Micrófono silenciado' : 'Silenciar micrófono'} onclick={() => void mute()}><Icon name="mic" size={19} /></button>
    <button class="icon-button" class:voice-muted={voice.deafened} disabled={!voice.participantId} aria-label={voice.deafened ? 'Volver a escuchar' : 'Dejar de escuchar'} aria-pressed={voice.deafened} title={voice.deafened ? 'Volver a escuchar' : 'Dejar de escuchar y silenciar micrófono'} onclick={() => void deafen()}><Icon name="headphones" size={19} /></button>
    <details class="voice-device-menu"><summary aria-label="Ajustes de audio" title="Ajustes de audio"><Icon name="settings" size={18} /></summary><div class="voice-device-options">
      <label for="voice-input">Micrófono</label><select id="voice-input" value={voice.inputDevice} disabled={!voice.participantId} onchange={(event) => void input(event.currentTarget.value)}><option value="">Predeterminado del sistema</option>{#each voice.devices.filter(item => item.kind === 'audioinput' && item.id !== 'default') as device}<option value={device.id}>{device.label}</option>{/each}</select>
      {#if canChooseOutput}<label for="voice-output">Salida de audio</label><select id="voice-output" value={voice.outputDevice} disabled={!voice.participantId} onchange={(event) => void output(event.currentTarget.value)}><option value="">Predeterminada del sistema</option>{#each voice.devices.filter(item => item.kind === 'audiooutput' && item.id !== 'default') as device}<option value={device.id}>{device.label}</option>{/each}</select>{:else}<p>La salida de audio se elige en los ajustes del sistema.</p>{/if}
      <label for="voice-volume">Volumen de voz · {Math.round(voice.volume * 100)} %</label><input id="voice-volume" aria-label="Volumen de voz" type="range" min="0" max="1" step="0.05" value={voice.volume} oninput={(event) => volume(Number(event.currentTarget.value))} />
    </div></details>
    <button class="icon-button voice-leave" aria-label="Salir del canal de voz" title="Salir del canal de voz" onclick={leave}><Icon name="logout" size={19} /></button>
  </div>
  {#if voice.playbackBlocked}<button class="secondary-button voice-enable-audio" onclick={() => void resume()}>Activar sonido</button>{/if}
  {#if voice.error}<p class="voice-inline-error" role="alert">{voice.error}</p>{/if}
</section>
