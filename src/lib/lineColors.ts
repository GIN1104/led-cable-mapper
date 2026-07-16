/** Палитры цветов для data- и power-линий в визуализации сетки */

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
 * Data Ports: 16 холодных оттенков с высокой хромой.
 * Соседние индексы прыгают по hue (~90–180°) и чередуют light/dark,
 * чтобы D1≠D2 визуально очевидны. Без red / orange / yellow.
 * Зелёные тона сдвинуты к лайму/бирюзе, чтобы не сливаться с backup.
 */
const DATA_HUES: { r: number; g: number; b: number }[] = [
  { r: 29, g: 78, b: 216 }, // 1  тёмно-синий
  { r: 217, g: 70, b: 239 }, // 2  светлая magenta
  { r: 15, g: 118, b: 110 }, // 3  тёмный teal
  { r: 167, g: 139, b: 250 }, // 4  светлый violet
  { r: 101, g: 163, b: 13 }, // 5  лайм (не «чистый» green backup)
  { r: 34, g: 211, b: 238 }, // 6  яркий cyan
  { r: 67, g: 56, b: 202 }, // 7  тёмный indigo
  { r: 244, g: 114, b: 182 }, // 8  светлый pink
  { r: 8, g: 145, b: 178 }, // 9  средний cyan-синий
  { r: 168, g: 85, b: 247 }, // 10 яркий purple
  { r: 19, g: 78, b: 74 }, // 11 глубокий teal (тёмный)
  { r: 129, g: 140, b: 248 }, // 12 светлый indigo
  { r: 190, g: 24, b: 93 }, // 13 глубокий rose/magenta
  { r: 45, g: 212, b: 191 }, // 14 светлый aqua
  { r: 76, g: 29, b: 149 }, // 15 тёмный violet
  { r: 125, g: 211, b: 252 }, // 16 светлый sky blue
]

/**
 * Power Lines: 14 оттенков только red→yellow.
 * Порядок не по радуге, а с прыжками hue + чередованием light/dark,
 * чтобы P1/P2 не были соседними оттенками одного семейства.
 */
const POWER_HUES: { r: number; g: number; b: number }[] = [
  { r: 127, g: 29, b: 29 }, // 1  глубокий crimson (тёмный)
  { r: 250, g: 204, b: 21 }, // 2  яркий yellow (светлый)
  { r: 194, g: 65, b: 12 }, // 3  тёмный оранжево-красный
  { r: 252, g: 211, b: 77 }, // 4  светлый amber/gold
  { r: 185, g: 28, b: 28 }, // 5  насыщенный red
  { r: 251, g: 146, b: 60 }, // 6  светлый orange
  { r: 120, g: 53, b: 15 }, // 7  тёмная охра / brown-orange
  { r: 248, g: 113, b: 113 }, // 8  светлый coral-red
  { r: 234, g: 88, b: 12 }, // 9  яркий orange
  { r: 161, g: 98, b: 7 }, // 10 тёмный gold
  { r: 239, g: 68, b: 68 }, // 11 светло-красный
  { r: 202, g: 138, b: 4 }, // 12 gold / mustard
  { r: 153, g: 27, b: 27 }, // 13 бордовый
  { r: 245, g: 158, b: 11 }, // 14 amber
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

function toColorSet(
  rgb: { r: number; g: number; b: number },
  fillAlpha: number,
): LineColorSet {
  const { r, g, b } = rgb
  return {
    fill: `rgba(${r}, ${g}, ${b}, ${fillAlpha})`,
    stroke: darken(r, g, b, 0.78),
    label: darken(r, g, b, 0.48),
    // Полный насыщенный hue — не сливается с полупрозрачной заливкой кубика
    arrow: toHex(r, g, b),
  }
}

/** Разные hue для data-портов (D1, D2, …) — холодная палитра без red/orange/yellow */
export const DATA_LINE_PALETTE: LineColorSet[] = DATA_HUES.map((rgb) =>
  toColorSet(rgb, 0.28),
)

/** Power-линии (P1, P2, …): только красно–жёлтое семейство */
export const POWER_LINE_PALETTE: LineColorSet[] = POWER_HUES.map((rgb) =>
  toColorSet(rgb, 0.22),
)

/**
 * Резервные data-линии: зелёное семейство (пунктир в UI).
 * Чистый forest/emerald — отдельно от лайма/aqua в DATA_HUES.
 */
export const BACKUP_LINE_PALETTE: LineColorSet[] = [
  { fill: 'rgba(22, 101, 52, 0.24)', stroke: '#14532d', label: '#052e16', arrow: '#16a34a' },
  { fill: 'rgba(21, 128, 61, 0.24)', stroke: '#166534', label: '#14532d', arrow: '#22c55e' },
  { fill: 'rgba(4, 120, 87, 0.24)', stroke: '#047857', label: '#064e3b', arrow: '#10b981' },
  { fill: 'rgba(6, 95, 70, 0.24)', stroke: '#065f46', label: '#022c22', arrow: '#059669' },
  { fill: 'rgba(34, 197, 94, 0.2)', stroke: '#15803d', label: '#14532d', arrow: '#22c55e' },
  { fill: 'rgba(16, 185, 129, 0.2)', stroke: '#059669', label: '#064e3b', arrow: '#34d399' },
]

const EMPTY_COLORS: LineColorSet = {
  fill: '#f8fafc',
  stroke: '#cbd5e1',
  label: '#64748b',
  arrow: '#64748b',
}

export function dataLineColor(portNum: number): LineColorSet {
  if (portNum <= 0) return EMPTY_COLORS
  return DATA_LINE_PALETTE[(portNum - 1) % DATA_LINE_PALETTE.length]
}

export function powerLineColor(lineNum: number): LineColorSet {
  if (lineNum <= 0) {
    return { fill: 'transparent', stroke: '#cbd5e1', label: '#64748b', arrow: '#64748b' }
  }
  return POWER_LINE_PALETTE[(lineNum - 1) % POWER_LINE_PALETTE.length]
}

export function backupLineColor(portNum: number): LineColorSet {
  if (portNum <= 0) {
    return { fill: 'transparent', stroke: '#16a34a', label: '#166534', arrow: '#16a34a' }
  }
  return BACKUP_LINE_PALETTE[(portNum - 1) % BACKUP_LINE_PALETTE.length]
}
