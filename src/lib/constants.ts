import type { RefreshRate, ScreenConfig } from '../types'
import { getPitchPreset } from './pitchPresets'

/** Константы маршрутизации LED-стен */

/** Лимит пикселей на 1G-порт при 50 Гц */
export const MAX_PIXELS_PER_DATA_PORT_50HZ = 786_000

/** Лимит пикселей на 1G-порт при 60 Гц */
export const MAX_PIXELS_PER_DATA_PORT_60HZ = 655_000

/** @deprecated Используйте getMaxPixelsPerDataPort(refreshRate) */
export const MAX_PIXELS_PER_DATA_PORT = MAX_PIXELS_PER_DATA_PORT_60HZ

/** Лимит пикселей на data-порт в зависимости от частоты обновления */
export function getMaxPixelsPerDataPort(refreshRate: RefreshRate): number {
  return refreshRate === 50
    ? MAX_PIXELS_PER_DATA_PORT_50HZ
    : MAX_PIXELS_PER_DATA_PORT_60HZ
}

/** Максимум кабинетов на data-порт: floor(maxPixels / pixelsPerCabinet) */
export function getMaxCabinetsPerDataPort(
  refreshRate: RefreshRate,
  pixelsPerCabinet: number,
): number {
  if (pixelsPerCabinet <= 0) return 1
  const maxPixels = getMaxPixelsPerDataPort(refreshRate)
  return Math.max(1, Math.floor(maxPixels / pixelsPerCabinet))
}

/** @deprecated Используйте getMaxCabinetsPerDataPort(refreshRate, pixelsPerCabinet) */
export const MAX_CABINETS_PER_DATA_PORT = 10

/** Максимальная мощность на линию питания (Вт) при 230В / 16А — вторичная проверка */
export const MAX_POWER_PER_LINE_W = 3500

/** Максимальная длина power-линка между соседними кабинетами (м) */
export const MAX_POWER_LINK_LENGTH_M = 1.5

/** Максимум кабинетов на линию питания по пресету или размерам кабинета */
export function getMaxCabinetsPerPowerLine(config: ScreenConfig): number {
  switch (config.pitchPreset) {
    case '3.9-big':
    case '3.9-reshet':
      return 12
    case '3.9-small':
      return 24
    case '2.9':
      return 40
    case 'custom':
      return getMaxCabinetsPerPowerLineFromDimensions(config)
    default:
      return getMaxCabinetsPerPowerLineFromDimensions(config)
  }
}

/** Целевое заполнение линии питания в авто-режиме (не превышать max) */
export function getPreferredCabinetsPerPowerLine(config: ScreenConfig): number {
  switch (config.pitchPreset) {
    case '3.9-big':
    case '3.9-reshet':
      return 10
    case '3.9-small':
      return 20
    case '2.9':
      return 40
    case 'custom':
      return preferredFromMax(getMaxCabinetsPerPowerLineFromDimensions(config))
    default:
      return preferredFromMax(getMaxCabinetsPerPowerLineFromDimensions(config))
  }
}

/** Подпись лимита питания для UI: «10–12 cab/line (3.9 Big)» */
export function getPowerLineLimitHint(config: ScreenConfig): string {
  const max = getMaxCabinetsPerPowerLine(config)
  const preferred = getPreferredCabinetsPerPowerLine(config)
  const presetLabel =
    config.pitchPreset !== 'custom'
      ? getPitchPreset(config.pitchPreset)?.label
      : undefined

  const range =
    preferred === max ? `${max}` : `${preferred}–${max}`
  const suffix = presetLabel ? ` (${presetLabel})` : ''
  return `${range} cab/line${suffix}`
}

function preferredFromMax(max: number): number {
  if (max === 12) return 10
  if (max === 24) return 20
  if (max === 40) return 40
  return Math.min(max, Math.max(1, Math.floor(max * 0.85)))
}

/** Запасной расчёт max по pitch и габаритам кабинета (custom) */
function getMaxCabinetsPerPowerLineFromDimensions(config: ScreenConfig): number {
  const pitch = config.pixelPitchMm
  const w = config.cabinetWidthMm
  const h = config.cabinetHeightMm

  if (pitch >= 2.85 && pitch <= 3.05) return 40

  if (h >= 950 && h <= 1050 && pitch >= 3.75 && pitch <= 4.05) return 12

  if (w >= 450 && w <= 550 && h >= 450 && h <= 550) return 24

  if (w >= 960 && pitch >= 3.5) return 12
  if (pitch < 2.5) return 16
  return 20
}

/** Длина горизонтального линка между соседними кабинетами (data) */
export const LINK_CABLE_HORIZONTAL_M = 0.7

/** Длина вертикального линка между соседними кабинетами (data) */
export const LINK_CABLE_VERTICAL_M = 1.2

/** Запас кабелей в упаковочном листе (+10%) */
export const SPARE_CABLE_FACTOR = 1.1

/** Цвета для визуализации */
export const COLORS = {
  data: '#3b82f6',
  dataBackup: '#22c55e',
  power: '#ef4444',
  powerAlt: '#f97316',
  cabinetFill: '#f8fafc',
  cabinetStroke: '#cbd5e1',
  cabinetText: '#334155',
} as const

/** Типы кабелей по категориям */
export const CABLE_TYPES = {
  dataTrunk: 'Cat6 SFTP + EtherCON NE8MC',
  dataLink: 'Cat6 SFTP + EtherCON NE8MC (short)',
  dataBackupTrunk: 'Cat6 SFTP + EtherCON NE8MC (backup)',
  dataBackupLink: 'Cat6 SFTP + EtherCON NE8MC (backup, short)',
  powerTrunk: '3×2.5mm² + PowerCON TRUE1',
  powerLink: '3×2.5mm² + PowerCON TRUE1 (short)',
} as const

/** Рекомендации по цветовой маркировке */
export const COLOR_ADVICE = {
  data: 'Blue heat-shrink / Blue Velcro',
  dataBackup: 'Green heat-shrink / Green Velcro (dashed route)',
  power: 'Red/Orange heat-shrink / Red Velcro',
} as const
