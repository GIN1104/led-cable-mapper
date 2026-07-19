/** Палитры цветов для data- и power-линий в визуализации сетки */

export type LineColorMode = 'data' | 'power'

export interface LineColorSet {
  /** Полупрозрачная заливка кабинета */
  fill: string
  /** Цвет обводки кабинета */
  stroke: string
  /** Более тёмный оттенок для подписей */
  label: string
  /** Цвет стрелки — контрастный к заливке кубика */
  arrow: string
}

/**
 * Data / Тикшорет: яркие насыщенные цвета, семьи подряд
 * (красный→алый→розовый, оранжевые, …). 24 уникальных.
 */
const DATA_HUES: { r: number; g: number; b: number }[] = [
  // красные / розовые
  { r: 255, g: 20, b: 20 },
  { r: 220, g: 0, b: 60 },
  { r: 255, g: 64, b: 160 },
  { r: 255, g: 0, b: 220 },
  // оранжевые
  { r: 255, g: 100, b: 0 },
  { r: 255, g: 140, b: 0 },
  { r: 255, g: 180, b: 40 },
  // жёлтые
  { r: 255, g: 220, b: 0 },
  { r: 200, g: 255, b: 0 },
  // зелёные
  { r: 80, g: 255, b: 0 },
  { r: 0, g: 220, b: 40 },
  { r: 0, g: 200, b: 120 },
  // циан / бирюза
  { r: 0, g: 230, b: 200 },
  { r: 0, g: 210, b: 255 },
  { r: 0, g: 160, b: 255 },
  // синие
  { r: 40, g: 80, b: 255 },
  { r: 80, g: 0, b: 255 },
  // фиолетовые / magenta
  { r: 150, g: 0, b: 255 },
  { r: 200, g: 0, b: 255 },
  { r: 255, g: 0, b: 180 },
  // доп. яркие акценты
  { r: 255, g: 50, b: 50 },
  { r: 50, g: 255, b: 100 },
  { r: 50, g: 120, b: 255 },
  { r: 255, g: 200, b: 50 },
]

/**
 * Power / Хашмаль: тёплые семьи подряд, хорошо различимые.
 */
const POWER_HUES: { r: number; g: number; b: number }[] = [
  // красные
  { r: 239, g: 68, b: 68 },
  { r: 185, g: 28, b: 28 },
  { r: 252, g: 165, b: 165 },
  // оранжевые
  { r: 249, g: 115, b: 22 },
  { r: 194, g: 65, b: 12 },
  { r: 253, g: 186, b: 116 },
  // жёлтые
  { r: 234, g: 179, b: 8 },
  { r: 161, g: 98, b: 7 },
  { r: 253, g: 224, b: 71 },
  // янтарь / кирпич
  { r: 217, g: 119, b: 6 },
  { r: 146, g: 64, b: 14 },
  { r: 251, g: 191, b: 36 },
  // глубокий красный / розовый
  { r: 220, g: 38, b: 38 },
  { r: 159, g: 18, b: 57 },
]

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

function darken(r: number, g: number, b: number, factor: number): string {
  return toHex(r * factor, g * factor, b * factor)
}

function toHex(r: number, g: number, b: number): string {
  return `#${[clampByte(r), clampByte(g), clampByte(b)]
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')}`
}

function labelFromRgb(r: number, g: number, b: number): string {
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.62 ? darken(r, g, b, 0.32) : darken(r, g, b, 0.5)
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255
  const gg = g / 255
  const bb = b / 255
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6
  else if (max === gg) h = ((bb - rr) / d + 2) / 6
  else h = ((rr - gg) / d + 4) / 6
  return [h, s, l]
}

function hue2rgb(p: number, q: number, t: number): number {
  let tt = t
  if (tt < 0) tt += 1
  if (tt > 1) tt -= 1
  if (tt < 1 / 6) return p + (q - p) * 6 * tt
  if (tt < 1 / 2) return q
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
  return p
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  if (s === 0) {
    const v = clampByte(l * 255)
    return { r: v, g: v, b: v }
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return {
    r: clampByte(hue2rgb(p, q, h + 1 / 3) * 255),
    g: clampByte(hue2rgb(p, q, h) * 255),
    b: clampByte(hue2rgb(p, q, h - 1 / 3) * 255),
  }
}

/**
 * Стрелка: противоположный оттенок, насыщенный и тёмный —
 * визуально не сливается с заливкой кубика.
 */
export function contrastArrowRgb(
  r: number,
  g: number,
  b: number,
): { r: number; g: number; b: number } {
  const [h, s] = rgbToHsl(r, g, b)
  const opp = (h + 0.5) % 1
  return hslToRgb(opp, Math.max(0.72, s), 0.32)
}

function toColorSet(
  rgb: { r: number; g: number; b: number },
  fillAlpha: number,
): LineColorSet {
  const { r, g, b } = rgb
  const arrow = contrastArrowRgb(r, g, b)
  return {
    fill: `rgba(${r}, ${g}, ${b}, ${fillAlpha})`,
    stroke: darken(r, g, b, 0.72),
    label: labelFromRgb(r, g, b),
    arrow: toHex(arrow.r, arrow.g, arrow.b),
  }
}

/** Data-порты: яркая заливка */
export const DATA_LINE_PALETTE: LineColorSet[] = DATA_HUES.map((rgb) =>
  toColorSet(rgb, 0.62),
)

/** Power-линии (P1, P2, …): тёплые семьи подряд */
export const POWER_LINE_PALETTE: LineColorSet[] = POWER_HUES.map((rgb) =>
  toColorSet(rgb, 0.45),
)

export const BACKUP_LINE_PALETTE: LineColorSet[] = [
  { fill: 'rgba(37, 99, 235, 0.35)', stroke: '#1d4ed8', label: '#1e3a8a', arrow: '#1d4ed8' },
  { fill: 'rgba(59, 130, 246, 0.35)', stroke: '#2563eb', label: '#1e40af', arrow: '#2563eb' },
  { fill: 'rgba(14, 165, 233, 0.35)', stroke: '#0284c7', label: '#075985', arrow: '#0284c7' },
  { fill: 'rgba(79, 70, 229, 0.35)', stroke: '#4338ca', label: '#312e81', arrow: '#4338ca' },
  { fill: 'rgba(2, 132, 199, 0.35)', stroke: '#0369a1', label: '#0c4a6e', arrow: '#0369a1' },
  { fill: 'rgba(99, 102, 241, 0.35)', stroke: '#4f46e5', label: '#3730a3', arrow: '#4f46e5' },
]

const EMPTY_COLORS: LineColorSet = {
  fill: '#f8fafc',
  stroke: '#cbd5e1',
  label: '#64748b',
  arrow: '#64748b',
}

/** Яркий procedural-цвет, если линий больше фиксированной палитры */
function proceduralBrightColor(index: number): LineColorSet {
  const hue = (index * 0.6180339887) % 1
  const rgb = hslToRgb(hue, 1, 0.5)
  return toColorSet(rgb, 0.62)
}

/** Размер базовой палитры (без procedural) */
export function basePaletteSize(mode: LineColorMode): number {
  return mode === 'data' ? DATA_LINE_PALETTE.length : POWER_LINE_PALETTE.length
}

/** Цвет из палитры по индексу (0-based); data не зацикливает — новые яркие цвета */
export function colorSetByIndex(mode: LineColorMode, index: number): LineColorSet {
  const palette = mode === 'data' ? DATA_LINE_PALETTE : POWER_LINE_PALETTE
  if (index < 0) return palette[0]!
  if (index < palette.length) return palette[index]!
  if (mode === 'data') return proceduralBrightColor(index)
  return palette[index % palette.length]!
}

/** @deprecated Используйте lineColorFromMap — оставлено для совместимости */
export function dataLineColor(portNum: number): LineColorSet {
  if (portNum <= 0) return EMPTY_COLORS
  return colorSetByIndex('data', portNum - 1)
}

/** @deprecated Используйте lineColorFromMap */
export function powerLineColor(lineNum: number): LineColorSet {
  if (lineNum <= 0) {
    return { fill: 'transparent', stroke: '#cbd5e1', label: '#64748b', arrow: '#64748b' }
  }
  return colorSetByIndex('power', lineNum - 1)
}

export function backupLineColor(portNum: number): LineColorSet {
  if (portNum <= 0) {
    return { fill: 'transparent', stroke: '#2563eb', label: '#1e40af', arrow: '#2563eb' }
  }
  return BACKUP_LINE_PALETTE[(portNum - 1) % BACKUP_LINE_PALETTE.length]!
}
