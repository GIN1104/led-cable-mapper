/** Палитры цветов для data- и power-линий в визуализации сетки */

export interface LineColorSet {
  /** Полупрозрачная заливка кабинета */
  fill: string
  /** Цвет обводки кабинета / стрелки */
  stroke: string
  /** Более тёмный оттенок для подписей */
  label: string
}

/** Оттенки синего — по одному на каждый data-порт */
export const DATA_LINE_PALETTE: LineColorSet[] = [
  { fill: 'rgba(37, 99, 235, 0.32)', stroke: '#1d4ed8', label: '#1e3a8a' },
  { fill: 'rgba(14, 165, 233, 0.32)', stroke: '#0369a1', label: '#0c4a6e' },
  { fill: 'rgba(59, 130, 246, 0.32)', stroke: '#2563eb', label: '#1e40af' },
  { fill: 'rgba(99, 102, 241, 0.32)', stroke: '#4f46e5', label: '#3730a3' },
  { fill: 'rgba(6, 182, 212, 0.32)', stroke: '#0891b2', label: '#155e75' },
  { fill: 'rgba(79, 70, 229, 0.32)', stroke: '#4338ca', label: '#312e81' },
  { fill: 'rgba(2, 132, 199, 0.32)', stroke: '#0284c7', label: '#075985' },
]

/** Оттенки красного/оранжевого — по одному на каждую power-линию */
export const POWER_LINE_PALETTE: LineColorSet[] = [
  { fill: 'rgba(220, 38, 38, 0.18)', stroke: '#dc2626', label: '#991b1b' },
  { fill: 'rgba(234, 88, 12, 0.18)', stroke: '#ea580c', label: '#9a3412' },
  { fill: 'rgba(239, 68, 68, 0.18)', stroke: '#ef4444', label: '#b91c1c' },
  { fill: 'rgba(249, 115, 22, 0.18)', stroke: '#f97316', label: '#c2410c' },
  { fill: 'rgba(244, 63, 94, 0.18)', stroke: '#f43f5e', label: '#be123c' },
]

/** Цвета резервных data-линий (зелёные оттенки) */
export const BACKUP_LINE_PALETTE: LineColorSet[] = [
  { fill: 'rgba(34, 197, 94, 0.22)', stroke: '#16a34a', label: '#166534' },
  { fill: 'rgba(22, 163, 74, 0.22)', stroke: '#15803d', label: '#14532d' },
  { fill: 'rgba(5, 150, 105, 0.22)', stroke: '#059669', label: '#065f46' },
  { fill: 'rgba(13, 148, 136, 0.22)', stroke: '#0d9488', label: '#115e59' },
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
