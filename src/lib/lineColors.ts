/** Палитры цветов для data- и power-линий в визуализации сетки */

export type LineColorMode = 'data' | 'power'

export interface LineColorSet {
  /** Полупрозрачная заливка кабинета */
  fill: string
  /** Цвет обводки кабинета */
  stroke: string
  /** Более тёмный оттенок для подписей */
  label: string
  /** Цвет стрелки — насыщенный, отдельно от заливки кубика */
  arrow: string
}

/**
 * Data / Тикшорет: ровно 16 ярких уникальных цветов.
 * Оттенки разнесены по кругу (~22.5°) и переставлены так,
 * чтобы соседние индексы палитры были максимально разными.
 */
const DATA_HUES: { r: number; g: number; b: number }[] = [
  { r: 255, g: 0, b: 0 }, // 1  красный
  { r: 0, g: 200, b: 255 }, // 2  голубой
  { r: 0, g: 200, b: 0 }, // 3  зелёный
  { r: 255, g: 0, b: 200 }, // 4  magenta
  { r: 255, g: 140, b: 0 }, // 5  оранжевый
  { r: 80, g: 0, b: 255 }, // 6  ультрамарин
  { r: 255, g: 255, b: 0 }, // 7  жёлтый
  { r: 0, g: 100, b: 80 }, // 8  тёмный teal
  { r: 255, g: 0, b: 100 }, // 9  малиновый
  { r: 0, g: 255, b: 180 }, // 10 аквамарин
  { r: 160, g: 0, b: 200 }, // 11 пурпурный
  { r: 180, g: 255, b: 0 }, // 12 лайм
  { r: 0, g: 60, b: 255 }, // 13 синий
  { r: 255, g: 80, b: 0 }, // 14 огненный
  { r: 0, g: 160, b: 120 }, // 15 изумруд
  { r: 200, g: 0, b: 80 }, // 16 рубиновый
]

/**
 * Power / Хашмаль: только тёплые red→yellow, контрастные между собой.
 */
const POWER_HUES: { r: number; g: number; b: number }[] = [
  { r: 239, g: 68, b: 68 },
  { r: 250, g: 204, b: 21 },
  { r: 249, g: 115, b: 22 },
  { r: 185, g: 28, b: 28 },
  { r: 245, g: 158, b: 11 },
  { r: 248, g: 113, b: 113 },
  { r: 234, g: 88, b: 12 },
  { r: 253, g: 224, b: 71 },
  { r: 153, g: 27, b: 27 },
  { r: 202, g: 138, b: 4 },
  { r: 251, g: 146, b: 60 },
  { r: 220, g: 38, b: 38 },
  { r: 161, g: 98, b: 7 },
  { r: 252, g: 211, b: 77 },
]

function darken(r: number, g: number, b: number, factor: number): string {
  const dr = Math.round(r * factor)
  const dg = Math.round(g * factor)
  const db = Math.round(b * factor)
  return `#${[dr, dg, db].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

function labelFromRgb(r: number, g: number, b: number): string {
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.62 ? darken(r, g, b, 0.32) : darken(r, g, b, 0.5)
}

function toColorSet(
  rgb: { r: number; g: number; b: number },
  fillAlpha: number,
): LineColorSet {
  const { r, g, b } = rgb
  return {
    fill: `rgba(${r}, ${g}, ${b}, ${fillAlpha})`,
    stroke: darken(r, g, b, 0.72),
    label: labelFromRgb(r, g, b),
    arrow: toHex(r, g, b),
  }
}

/** Data-порты (D1…D16): 16 ярких уникальных цветов */
export const DATA_LINE_PALETTE: LineColorSet[] = DATA_HUES.map((rgb) =>
  toColorSet(rgb, 0.58),
)

/** Power-линии (P1, P2, …): тёплая палитра */
export const POWER_LINE_PALETTE: LineColorSet[] = POWER_HUES.map((rgb) =>
  toColorSet(rgb, 0.48),
)

export const BACKUP_LINE_PALETTE: LineColorSet[] = [
  { fill: 'rgba(22, 101, 52, 0.42)', stroke: '#14532d', label: '#052e16', arrow: '#15803d' },
  { fill: 'rgba(21, 128, 61, 0.42)', stroke: '#166534', label: '#14532d', arrow: '#16a34a' },
  { fill: 'rgba(4, 120, 87, 0.42)', stroke: '#047857', label: '#064e3b', arrow: '#059669' },
  { fill: 'rgba(6, 95, 70, 0.42)', stroke: '#065f46', label: '#022c22', arrow: '#047857' },
  { fill: 'rgba(20, 83, 45, 0.4)', stroke: '#14532d', label: '#052e16', arrow: '#166534' },
  { fill: 'rgba(5, 150, 105, 0.4)', stroke: '#0f766e', label: '#134e4a', arrow: '#0d9488' },
]

const EMPTY_COLORS: LineColorSet = {
  fill: '#f8fafc',
  stroke: '#cbd5e1',
  label: '#64748b',
  arrow: '#64748b',
}

/** Цвет из палитры по индексу (0-based) */
export function colorSetByIndex(mode: LineColorMode, index: number): LineColorSet {
  const palette = mode === 'data' ? DATA_LINE_PALETTE : POWER_LINE_PALETTE
  const i = ((index % palette.length) + palette.length) % palette.length
  return palette[i]!
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
    return { fill: 'transparent', stroke: '#16a34a', label: '#166534', arrow: '#16a34a' }
  }
  return BACKUP_LINE_PALETTE[(portNum - 1) % BACKUP_LINE_PALETTE.length]!
}
