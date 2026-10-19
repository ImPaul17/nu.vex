export interface ThemePreferences {
  version: 1;
  theme: 'emerald' | 'midnight' | 'light';
  accent: string;
  glass: number;
  radius: number;
  density: 'comfortable' | 'compact';
}

export const MAX_THEME_JSON_BYTES = 16 * 1_024;

export const defaultTheme: Readonly<ThemePreferences> = Object.freeze({
  version: 1,
  theme: 'emerald',
  accent: '#14D392',
  glass: 0.78,
  radius: 16,
  density: 'comfortable',
});

const keys = new Set(['version', 'theme', 'accent', 'glass', 'radius', 'density']);

/** A deliberately small data-only format: no CSS, URLs, scripts or extensions. */
export function validateTheme(input: unknown): ThemePreferences {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('El tema debe ser un objeto JSON.');
  }
  const values = input as Record<string, unknown>;
  if (Object.keys(values).length !== keys.size || Object.keys(values).some((key) => !keys.has(key))) {
    throw new Error('El tema contiene campos desconocidos o incompletos.');
  }
  if (values.version !== 1) {
    throw new Error('Esta versión del tema no es compatible.');
  }
  if (values.theme !== 'emerald' && values.theme !== 'midnight' && values.theme !== 'light') {
    throw new Error('El estilo del tema no es válido.');
  }
  if (typeof values.accent !== 'string' || values.accent.length !== 7 || !/^#[0-9a-fA-F]{6}$/.test(values.accent)) {
    throw new Error('El acento debe ser un color hexadecimal con formato #RRGGBB.');
  }
  if (typeof values.glass !== 'number' || !Number.isFinite(values.glass) || values.glass < 0 || values.glass > 1) {
    throw new Error('La transparencia debe estar entre 0 y 1.');
  }
  if (typeof values.radius !== 'number' || !Number.isFinite(values.radius) || values.radius < 4 || values.radius > 24) {
    throw new Error('El radio debe estar entre 4 y 24.');
  }
  if (values.density !== 'comfortable' && values.density !== 'compact') {
    throw new Error('La densidad no es válida.');
  }

  // Return a fresh whitelist of validated primitives, never the imported object.
  return {
    version: 1,
    theme: values.theme,
    accent: values.accent,
    glass: values.glass,
    radius: values.radius,
    density: values.density,
  };
}

export function parseTheme(json: string): ThemePreferences {
  if (typeof json !== 'string' || new TextEncoder().encode(json).byteLength > MAX_THEME_JSON_BYTES) {
    throw new Error('El archivo de tema supera el límite de 16 KB.');
  }
  let input: unknown;
  try {
    input = JSON.parse(json);
  } catch {
    throw new Error('El archivo de tema no contiene JSON válido.');
  }
  return validateTheme(input);
}

export function serializeTheme(theme: ThemePreferences): string {
  return JSON.stringify(validateTheme(theme), null, 2);
}
