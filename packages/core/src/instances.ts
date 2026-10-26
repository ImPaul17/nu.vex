/** Direcciones recientes del dispositivo. Nunca contiene credenciales ni sesiones. */
export type SavedInstance = { url: string; name: string; lastUsedAt: number };

function origin(value: string): string {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && local))) throw new Error('Dirección de instancia no válida.');
  return url.origin;
}

export function parseSavedInstances(json: string): SavedInstance[] {
  if (json.length > 16_384) return [];
  try {
    const data: unknown = JSON.parse(json);
    if (!Array.isArray(data)) return [];
    const result: SavedInstance[] = [];
    for (const item of data.slice(0, 100)) {
      if (!item || typeof item !== 'object' || typeof item.url !== 'string' ||
          typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80) continue;
      try {
        const url = origin(item.url);
        if (!result.some((entry) => entry.url === url)) result.push({ url, name: item.name.trim(), lastUsedAt: typeof item.lastUsedAt === 'number' && Number.isFinite(item.lastUsedAt) ? item.lastUsedAt : 0 });
      } catch { /* Una entrada dañada no impide recuperar las otras. */ }
      if (result.length === 6) break;
    }
    return result;
  } catch { return []; }
}

export function rememberInstance(saved: SavedInstance[], item: { url: string; name: string }, now = Date.now()): SavedInstance[] {
  const url = origin(item.url);
  const next = { url, name: item.name.trim().slice(0, 80) || 'Instancia nu.vex', lastUsedAt: now };
  return [next, ...saved.filter((entry) => entry.url !== url)].slice(0, 6);
}
