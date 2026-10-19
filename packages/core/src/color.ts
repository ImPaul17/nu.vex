/** Picks the black or white foreground with the higher WCAG contrast ratio. */
export function accentForeground(hex: string): '#000000' | '#ffffff' {
  if (typeof hex !== 'string' || hex.length !== 7 || !/^#[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error('El acento debe ser un color hexadecimal con formato #RRGGBB.');
  }

  const linear = (offset: number): number => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * linear(1) + 0.7152 * linear(3) + 0.0722 * linear(5);
  const blackContrast = (luminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (luminance + 0.05);
  return blackContrast >= whiteContrast ? '#000000' : '#ffffff';
}
