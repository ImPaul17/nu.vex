<script lang="ts">
  import { defaultTheme, parseTheme, serializeTheme, type ThemePreferences } from '@nuvex/core';
  import Icon from './Icon.svelte';
  import { isNative } from '$lib/services/native';
  let { preferences, change }: { preferences: ThemePreferences; change: (value: ThemePreferences) => void } = $props();
  let error = $state('');
  let showJson = $state(false);
  let importInput: HTMLInputElement;
  const themes = [{ id: 'emerald', name: 'Bosque', description: 'El verde de casa', color: '#123c32' }, { id: 'midnight', name: 'Medianoche', description: 'Calma al anochecer', color: '#202936' }, { id: 'light', name: 'Luz de día', description: 'Un poco de claridad', color: '#dcece2' }] as const;
  function patch(value: Partial<ThemePreferences>) { change({ ...preferences, ...value }); }
  async function importTheme(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    try {
      if (file) {
        if (file.size > 16_384) throw new Error('El tema no puede superar 16 KB.');
        change(parseTheme(await file.text())); error = '';
      }
    } catch (cause) { error = cause instanceof Error ? cause.message : 'No se pudo importar el tema.'; }
    importInput.value = '';
  }
  function exportTheme() {
    if (isNative) { showJson = !showJson; return; }
    const url = URL.createObjectURL(new Blob([serializeTheme(preferences)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'nuvex-theme.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
</script>

<p class="modal-description">Haz que este espacio se sienta tuyo. Los cambios se guardan en este dispositivo.</p>
<h3 class="setting-heading">Tema de la interfaz</h3>
<div class="theme-grid">{#each themes as theme}<button class="theme-option" class:selected={preferences.theme === theme.id} aria-pressed={preferences.theme === theme.id} onclick={() => patch({ theme: theme.id })}><span class="theme-preview" style:background={theme.color}><span></span><span></span><span></span>{#if preferences.theme === theme.id}<span class="theme-check"><Icon name="check" size={14} /></span>{/if}</span><strong>{theme.name}</strong><small>{theme.description}</small></button>{/each}</div>
<div class="setting-row"><div><label for="accent">Color de acento</label><small>Los logos conservan sus colores originales.</small></div><input id="accent" type="color" value={preferences.accent} oninput={(event) => patch({ accent: event.currentTarget.value })} /></div>
<div class="setting-row"><div><label for="glass">Transparencia del cristal</label><small>{Math.round((1 - preferences.glass) * 100)}% de transparencia</small></div><input id="glass" type="range" min="0" max="1" step="0.01" value={preferences.glass} oninput={(event) => patch({ glass: +event.currentTarget.value })} /></div>
<div class="setting-row"><div><label for="radius">Esquinas redondeadas</label><small>{preferences.radius} px</small></div><input id="radius" type="range" min="4" max="24" step="1" value={preferences.radius} oninput={(event) => patch({ radius: +event.currentTarget.value })} /></div>
<div class="setting-row"><div><label for="density">Densidad de mensajes</label><small>Elige cuánto espacio necesitas.</small></div><select id="density" value={preferences.density} onchange={(event) => patch({ density: event.currentTarget.value as ThemePreferences['density'] })}><option value="comfortable">Cómoda</option><option value="compact">Compacta</option></select></div>
<div class="setting-footer"><button class="text-button" onclick={() => change({ ...defaultTheme })}>Restablecer</button><div><input type="file" accept=".json,application/json" class="visually-hidden" tabindex="-1" bind:this={importInput} onchange={importTheme} aria-label="Importar archivo de tema JSON" /><button class="secondary-button" onclick={() => importInput.click()}>Importar tema</button><button class="primary-button" onclick={exportTheme} aria-expanded={isNative ? showJson : undefined}><Icon name={isNative ? 'code' : 'download'} size={15} /> {isNative ? 'Ver JSON' : 'Exportar'}</button></div></div>
{#if showJson && isNative}<div class="theme-export"><label for="theme-json">JSON del tema para copiar</label><textarea id="theme-json" class="code-input" rows="9" readonly value={serializeTheme(preferences)} onfocus={(event) => event.currentTarget.select()}></textarea><p class="privacy-note">Copia este JSON y guárdalo en un archivo .json para importarlo en otro dispositivo.</p></div>{/if}
{#if error}<p class="form-error" role="alert">{error}</p>{/if}
<p class="privacy-note"><Icon name="shield" size={14} /> Solo preferencias visuales en JSON. Sin scripts, credenciales ni acceso a tus mensajes.</p>

<style>.theme-export { margin-top: 20px; } .theme-export label { display: block; margin-bottom: 8px; font-size: 12px; } .theme-export textarea { resize: vertical; }</style>
