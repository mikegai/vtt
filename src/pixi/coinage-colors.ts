import type { CoinageMetalFraction } from '../domain/coinage'

/** Same order as `drawCoinageMetalStrip` — hex + fraction key. */
export const COINAGE_METAL_FILL_HEX: readonly { readonly key: keyof CoinageMetalFraction; readonly hex: number }[] = [
  { key: 'cp', hex: 0xb87333 },
  { key: 'bp', hex: 0xcd7f32 },
  { key: 'sp', hex: 0xc0c0c0 },
  { key: 'ep', hex: 0x9acd32 },
  { key: 'gp', hex: 0xffd700 },
  { key: 'pp', hex: 0xe5e4e2 },
]

const hexToRgb = (hex: number): { r: number; g: number; b: number } => ({
  r: (hex >> 16) & 0xff,
  g: (hex >> 8) & 0xff,
  b: hex & 0xff,
})

const rgbToHex = (r: number, g: number, b: number): number =>
  (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)

/** Relative luminance 0–1 (sRGB). */
export const relativeLuminanceFromHex = (hex: number): number => {
  const { r, g, b } = hexToRgb(hex)
  const lin = (c: number) => {
    const x = c / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** Weighted average fill for segment body from metal fractions. */
export const blendFillColorFromMetals = (metals: CoinageMetalFraction): number => {
  let r = 0
  let g = 0
  let b = 0
  let w = 0
  for (const { key, hex } of COINAGE_METAL_FILL_HEX) {
    const f = metals[key]
    if (f <= 0) continue
    const { r: rr, g: gg, b: bb } = hexToRgb(hex)
    r += rr * f
    g += gg * f
    b += bb * f
    w += f
  }
  if (w <= 0) return 0x3d9ac9
  return rgbToHex(r / w, g / w, b / w)
}

/** BitmapText fill: light on dark segments, dark on bright metallic fills. */
export const labelFillForCoinageBackground = (fillHex: number): string =>
  relativeLuminanceFromHex(fillHex) > 0.55 ? '#1a1520' : '#f0f8ff'
