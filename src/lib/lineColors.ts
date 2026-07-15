/** Палитры цветов для data- и power-линий в визуализации сетки */

export interface LineColorSet {
  /** Полупрозрачная заливка кабинета */
  fill: string
  /** Цвет обводки кабинета / стрелки */
  stroke: string
  /** Более тёмный оттенок для подписей */
  label: string
}

/**
 * Высококонтрастная палитра: соседние индексы — разные оттенки (не соседние hue).
 * Порядок подобран так, чтобы соседние номера линий сильно отличались.
 */
const DISTINCT_HUES: { r: number; g: number; b: number }[] = [
  { r: 37, g: 99, b: 235 }, // синий
  { r: 234, g: 88, b: 12 }, // оранжевый
  { r: 124, g: 58, b: 237 }, // фиолетовый
  { r: 13, g: 148, b: 136 }, // бирюзовый
  { r: 220, g: 38, b: 38 }, // красный
  { r: 101, g: 163, b: 13 }, // лайм
  { r: 192, g: 38, b: 211 }, // пурпурный / magenta
  { r: 146, g: 64, b: 14 }, // коричневый
  { r: 8, g: 145, b: 178 }, // cyan
  { r: 202, g: 138, b: 4 }, // золотой
  { r: 67, g: 56, b: 202 }, // индиго
  { r: 219, g: 39, b: 119 }, // розовый
  { r: 14, g: 116, b: 144 }, // тёмный cyan
  { r: 180, g: 83, b: 9 }, // янтарный
]

function darken(r: number, g: number, b: number, factor: number): string {
  const dr = Math.round(r * factor)
  const dg = Math.round(g * factor)
  const db = Math.round(b * factor)
  return `#${[dr, dg, db].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

function toColorSet(
  rgb: { r: number; g: number; b: number },
  fillAlpha: number,
): LineColorSet {
  const { r, g, b } = rgb
  return {
    fill: `rgba(${r}, ${g}, ${b}, ${fillAlpha})`,
    stroke: darken(r, g, b, 0.85),
    label: darken(r, g, b, 0.55),
  }
}

/** Разные hue для data-портов (D1, D2, …) — не только синие оттенки */
export const DATA_LINE_PALETTE: LineColorSet[] = DISTINCT_HUES.map((rgb) =>
  toColorSet(rgb, 0.28),
)

/**
 * Power-линии (P1, P2, …): та же палитра, но со сдвигом на половину,
 * чтобы P-n не совпадал по цвету с D-n при одновременном отображении.
 */
const POWER_HUE_OFFSET = Math.floor(DISTINCT_HUES.length / 2)

export const POWER_LINE_PALETTE: LineColorSet[] = DISTINCT_HUES.map((_, i) => {
  const rgb = DISTINCT_HUES[(i + POWER_HUE_OFFSET) % DISTINCT_HUES.length]
  return toColorSet(rgb, 0.2)
})

/** Цвета резервных data-линий (зелёное семейство, пунктир задаётся в UI) */
export const BACKUP_LINE_PALETTE: LineColorSet[] = [
  { fill: 'rgba(22, 163, 74, 0.22)', stroke: '#15803d', label: '#14532d' },
  { fill: 'rgba(34, 197, 94, 0.22)', stroke: '#16a34a', label: '#166534' },
  { fill: 'rgba(5, 150, 105, 0.22)', stroke: '#059669', label: '#065f46' },
  { fill: 'rgba(4, 120, 87, 0.22)', stroke: '#047857', label: '#064e3b' },
]

export function dataLineColor(portNum: number): LineColorSet {
  if (portNum <= 0) {
    return { fill: '#f8fafc', stroke: '#cbd5e1', label: '#64748b' }
  }
  return DATA_LINE_PALETTE[(portNum - 1) % DATA_LINE_PALETTE.length]
}

export function powerLineColor(lineNum: number): LineColorSet {
  if (lineNum <= 0) {
    return { fill: 'transparent', stroke: '#cbd5e1', label: '#64748b' }
  }
  return POWER_LINE_PALETTE[(lineNum - 1) % POWER_LINE_PALETTE.length]
}

export function backupLineColor(portNum: number): LineColorSet {
  if (portNum <= 0) {
    return { fill: 'transparent', stroke: '#16a34a', label: '#166534' }
  }
  return BACKUP_LINE_PALETTE[(portNum - 1) % BACKUP_LINE_PALETTE.length]
}
