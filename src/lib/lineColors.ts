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
 * Data Ports: контрастные холодные/нейтральные оттенки.
 * Без красных, оранжевых и жёлтых тонов (они зарезервированы за Power).
 * Соседние индексы намеренно «прыгают» по hue.
 */
const DATA_HUES: { r: number; g: number; b: number }[] = [
  { r: 37, g: 99, b: 235 }, // синий
  { r: 124, g: 58, b: 237 }, // фиолетовый
  { r: 13, g: 148, b: 136 }, // бирюзовый
  { r: 101, g: 163, b: 13 }, // лайм / олива
  { r: 192, g: 38, b: 211 }, // пурпурный / magenta
  { r: 8, g: 145, b: 178 }, // cyan
  { r: 67, g: 56, b: 202 }, // индиго
  { r: 219, g: 39, b: 119 }, // розовый (магента)
  { r: 14, g: 116, b: 144 }, // тёмный cyan
  { r: 22, g: 163, b: 74 }, // зелёный
  { r: 79, g: 70, b: 229 }, // яркий индиго
  { r: 6, g: 182, b: 212 }, // светлый cyan
  { r: 147, g: 51, b: 234 }, // яркий фиолетовый
  { r: 21, g: 128, b: 61 }, // лесной зелёный
]

/**
 * Power Lines: только семейство красный → жёлтый.
 * Не пересекается с холодной data-палитрой.
 */
const POWER_HUES: { r: number; g: number; b: number }[] = [
  { r: 185, g: 28, b: 28 }, // тёмно-красный
  { r: 220, g: 38, b: 38 }, // красный
  { r: 234, g: 88, b: 12 }, // оранжево-красный
  { r: 249, g: 115, b: 22 }, // оранжевый
  { r: 217, g: 119, b: 6 }, // янтарный
  { r: 202, g: 138, b: 4 }, // золотой
  { r: 161, g: 98, b: 7 }, // тёплая охра
  { r: 153, g: 27, b: 27 }, // бордовый
  { r: 239, g: 68, b: 68 }, // светло-красный
  { r: 251, g: 146, b: 60 }, // светло-оранжевый
  { r: 245, g: 158, b: 11 }, // янтарь / жёлтый
  { r: 180, g: 83, b: 9 }, // коричнево-оранжевый
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

/** Разные hue для data-портов (D1, D2, …) — холодная палитра без red/orange/yellow */
export const DATA_LINE_PALETTE: LineColorSet[] = DATA_HUES.map((rgb) =>
  toColorSet(rgb, 0.28),
)

/** Power-линии (P1, P2, …): только красно–жёлтое семейство */
export const POWER_LINE_PALETTE: LineColorSet[] = POWER_HUES.map((rgb) =>
  toColorSet(rgb, 0.2),
)

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
