import type { PitchPresetId, RowMixBand, ScreenConfig } from '../types'
import { getPitchPreset } from './pitchPresets'
import type { ResolvedStripPitch } from './stripPitch'
import { stripPitchFromPreset } from './stripPitch'

/** Допустимые размеры для микса рядов в одном экране */
export const ROW_MIX_SIZES = ['3.9-big', '3.9-small'] as const
export type RowMixSize = (typeof ROW_MIX_SIZES)[number]

export function isRowMixSize(id: string): id is RowMixSize {
  return id === '3.9-big' || id === '3.9-small'
}

/** Нормализация полос микса (сверху вниз) */
export function normalizeRowMixBands(
  bands: RowMixBand[] | undefined,
): RowMixBand[] {
  if (!bands || bands.length === 0) return []
  return bands
    .map((b) => ({
      size: isRowMixSize(b.size) ? b.size : ('3.9-small' as RowMixSize),
      rows: Math.max(0, Math.floor(b.rows) || 0),
    }))
    .filter((b) => b.rows > 0)
}

/** Активен ли микс рядов (только при одном блоке) */
export function isRowMixActive(config: ScreenConfig): boolean {
  const strips = config.stripWidths?.length ?? 1
  if (strips > 1) return false
  return normalizeRowMixBands(config.rowMixBands).length > 0
}

export function rowMixGeo(size: RowMixSize): ResolvedStripPitch {
  const preset = getPitchPreset(size)!
  return {
    cabinetWidthMm: preset.cabinetWidthMm,
    cabinetHeightMm: preset.cabinetHeightMm,
    pixelPitchMm: preset.pixelPitchMm,
    pitchPreset: preset.id,
    pixelsWide: preset.pixelsWide,
    pixelsHigh: preset.pixelsHigh,
    totalPixels: preset.pixelsWide * preset.pixelsHigh,
    isOverride: true,
  }
}

/** Сводка микса: ряды, мм высоты, пиксели */
export function summarizeRowMix(bands: RowMixBand[]): {
  cabinetsHigh: number
  wallHeightM: number
  pixelsHigh: number
  /** Высота каждого ряда сверху вниз, мм */
  rowHeightsMm: number[]
  /** Геометрия каждого ряда сверху вниз */
  rowGeos: ResolvedStripPitch[]
} {
  const normalized = normalizeRowMixBands(bands)
  const rowGeos: ResolvedStripPitch[] = []
  const rowHeightsMm: number[] = []
  let pixelsHigh = 0
  let heightMm = 0
  for (const band of normalized) {
    const geo = rowMixGeo(band.size)
    for (let i = 0; i < band.rows; i++) {
      rowGeos.push(geo)
      rowHeightsMm.push(geo.cabinetHeightMm)
      pixelsHigh += geo.pixelsHigh
      heightMm += geo.cabinetHeightMm
    }
  }
  return {
    cabinetsHigh: rowGeos.length,
    wallHeightM: heightMm / 1000,
    pixelsHigh,
    rowHeightsMm,
    rowGeos,
  }
}

/** Геометрия ряда при активном миксе; иначе null */
export function resolveRowMixPitch(
  config: ScreenConfig,
  row: number,
): ResolvedStripPitch | null {
  if (!isRowMixActive(config)) return null
  const { rowGeos } = summarizeRowMix(config.rowMixBands)
  return rowGeos[row] ?? null
}

/** Высоты рядов мм (или null если микс выкл.) */
export function rowMixHeightsMm(config: ScreenConfig): number[] | null {
  if (!isRowMixActive(config)) return null
  return summarizeRowMix(config.rowMixBands).rowHeightsMm
}

/**
 * Применить микс рядов Big/Small к одному экрану.
 * Порядок bands — сверху вниз.
 */
export function applyRowMixBands(
  config: ScreenConfig,
  bands: RowMixBand[],
): ScreenConfig {
  const normalized = normalizeRowMixBands(bands)
  if (normalized.length === 0) {
    return {
      ...config,
      rowMixBands: [],
    }
  }
  const summary = summarizeRowMix(normalized)
  // Базовый размер экрана — Small (ширина общая); высота стены из суммы полос
  const basePreset = getPitchPreset('3.9-small')!
  return {
    ...config,
    rowMixBands: normalized,
    stripWidths: [config.cabinetsWide],
    stripHeights: [summary.cabinetsHigh],
    stripPitchConfigs: [stripPitchFromPreset('3.9-small' as PitchPresetId)],
    dualVx1000: false,
    cabinetsHigh: summary.cabinetsHigh,
    wallHeightM: summary.wallHeightM,
    cabinetWidthMm: basePreset.cabinetWidthMm,
    cabinetHeightMm: basePreset.cabinetHeightMm,
    pixelPitchMm: basePreset.pixelPitchMm,
    pitchPreset: 'custom',
    customDensityInput: 'pixels',
    customPixelsWide: basePreset.pixelsWide,
    customPixelsHigh: basePreset.pixelsHigh,
  }
}

/** Собрать bands из числа линий Big / Small */
export function bandsFromBigSmallCounts(
  bigRows: number,
  smallRows: number,
  bigOnTop: boolean,
): RowMixBand[] {
  const big = Math.max(0, Math.floor(bigRows) || 0)
  const small = Math.max(0, Math.floor(smallRows) || 0)
  const bands: RowMixBand[] = []
  if (bigOnTop) {
    if (big > 0) bands.push({ size: '3.9-big', rows: big })
    if (small > 0) bands.push({ size: '3.9-small', rows: small })
  } else {
    if (small > 0) bands.push({ size: '3.9-small', rows: small })
    if (big > 0) bands.push({ size: '3.9-big', rows: big })
  }
  return bands
}

export function countsFromRowMixBands(bands: RowMixBand[] | undefined): {
  bigRows: number
  smallRows: number
  bigOnTop: boolean
} {
  const n = normalizeRowMixBands(bands)
  let bigRows = 0
  let smallRows = 0
  for (const b of n) {
    if (b.size === '3.9-big') bigRows += b.rows
    else smallRows += b.rows
  }
  const firstBig = n[0]?.size === '3.9-big'
  const firstSmall = n[0]?.size === '3.9-small'
  // Если только один тип — bigOnTop = true по умолчанию
  const bigOnTop = firstBig || !firstSmall
  return { bigRows, smallRows, bigOnTop }
}
