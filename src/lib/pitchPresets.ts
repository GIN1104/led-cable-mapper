import type { PitchPresetId } from '../types'

/** Описание пресета шага пикселя */
export interface PitchPreset {
  id: PitchPresetId
  label: string
  cabinetWidthMm: number
  cabinetHeightMm: number
  pixelsWide: number
  pixelsHigh: number
  /** Шаг пикселя для лимитов линий питания */
  pixelPitchMm: number
}

/** Пресеты шага пикселя — точные размеры кабинета и пиксели */
export const PITCH_PRESETS: PitchPreset[] = [
  {
    id: '3.9-big',
    label: '3.9 Big',
    cabinetWidthMm: 500,
    cabinetHeightMm: 1000,
    pixelsWide: 128,
    pixelsHigh: 256,
    pixelPitchMm: 3.9,
  },
  {
    id: '3.9-small',
    label: '3.9 small',
    cabinetWidthMm: 500,
    cabinetHeightMm: 500,
    pixelsWide: 128,
    pixelsHigh: 128,
    pixelPitchMm: 3.9,
  },
  {
    id: '3.9-reshet',
    label: '3.9 Reshet',
    cabinetWidthMm: 500,
    cabinetHeightMm: 1000,
    pixelsWide: 256,
    pixelsHigh: 64,
    pixelPitchMm: 3.9,
  },
  {
    id: '2.9',
    label: '2.9',
    cabinetWidthMm: 500,
    cabinetHeightMm: 500,
    pixelsWide: 168,
    pixelsHigh: 168,
    pixelPitchMm: 2.9,
  },
]

export const CUSTOM_PRESET_LABEL = 'Custom / Другой...'

/** Находит пресет по id (не включая custom) */
export function getPitchPreset(id: PitchPresetId): PitchPreset | undefined {
  if (id === 'custom') return undefined
  return PITCH_PRESETS.find((p) => p.id === id)
}

/** Применяет значения пресета к конфигу экрана */
export function applyPitchPreset<T extends {
  pitchPreset: PitchPresetId
  cabinetWidthMm: number
  cabinetHeightMm: number
  pixelPitchMm: number
}>(config: T, presetId: PitchPresetId): T {
  if (presetId === 'custom') {
    return { ...config, pitchPreset: 'custom' }
  }
  const preset = getPitchPreset(presetId)
  if (!preset) return config
  return {
    ...config,
    pitchPreset: presetId,
    cabinetWidthMm: preset.cabinetWidthMm,
    cabinetHeightMm: preset.cabinetHeightMm,
    pixelPitchMm: preset.pixelPitchMm,
    densityMode: 'pitch',
  }
}
