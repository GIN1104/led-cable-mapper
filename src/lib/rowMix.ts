import type { RowMixBand, ScreenConfig } from '../types'
import { getPitchPreset } from './pitchPresets'
import type { ResolvedStripPitch } from './stripPitch'

/** Допустимые размеры для микса рядов в одном экране */
export const ROW_MIX_SIZES = ['3.9-big', '3.9-small'] as const
export type RowMixSize = (typeof ROW_MIX_SIZES)[number]

export function isRowMixSize(id: string): id is RowMixSize {
  return id === '3.9-big' || id === '3.9-small'
}

/** Нормализация полос микса одного стрипа (сверху вниз) */
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

/** Микс Big/Small на каждой полосе; миграция с устаревшего rowMixBands */
export function normalizeStripRowMixBands(
  bands: RowMixBand[][] | undefined,
  stripCount: number,
  legacyRowMixBands?: RowMixBand[],
): RowMixBand[][] {
  const n = Math.max(1, Math.floor(stripCount) || 1)
  if (bands && bands.length === n) {
    return bands.map((b) => normalizeRowMixBands(b))
  }
  const legacy = normalizeRowMixBands(legacyRowMixBands)
  if (legacy.length > 0) {
    return Array.from({ length: n }, () => [...legacy])
  }
  return Array.from({ length: n }, () => [])
}

export function stripRowMixBandsFor(
  config: ScreenConfig,
  stripCount?: number,
): RowMixBand[][] {
  const n = stripCount ?? config.stripWidths?.length ?? 1
  return normalizeStripRowMixBands(
    config.stripRowMixBands,
    n,
    config.rowMixBands,
  )
}

export function isStripRowMixActive(bands: RowMixBand[] | undefined): boolean {
  return normalizeRowMixBands(bands).length > 0
}

/** Любая полоса с миксом Big/Small */
export function isRowMixActive(config: ScreenConfig): boolean {
  return stripRowMixBandsFor(config).some((b) => isStripRowMixActive(b))
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
  rowHeightsMm: number[]
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

/** Геометрия ряда внутри стрипа (0 = верх стрипа) */
export function resolveStripRowMixPitch(
  config: ScreenConfig,
  stripIndex: number,
  rowInStrip: number,
): ResolvedStripPitch | null {
  const bands = stripRowMixBandsFor(config)[stripIndex]
  if (!isStripRowMixActive(bands)) return null
  const { rowGeos } = summarizeRowMix(bands!)
  if (rowInStrip < 0 || rowInStrip >= rowGeos.length) return null
  return rowGeos[rowInStrip] ?? null
}

/** @deprecated используйте resolveStripRowMixPitch */
export function resolveRowMixPitch(
  config: ScreenConfig,
  row: number,
): ResolvedStripPitch | null {
  return resolveStripRowMixPitch(config, 0, row)
}

/** Пиксели каждого ряда по полосам (null = микс выкл. на полосе) */
export function rowMixPixelsPerStrip(
  config: ScreenConfig,
): Array<Array<{ pixelsWide: number; pixelsHigh: number }> | null> {
  return stripRowMixBandsFor(config).map((bands) => {
    if (!isStripRowMixActive(bands)) return null
    const { rowGeos } = summarizeRowMix(bands!)
    return rowGeos.map((g) => ({
      pixelsWide: g.pixelsWide,
      pixelsHigh: g.pixelsHigh,
    }))
  })
}

/** @deprecated — первый стрип с миксом, для совместимости */
export function rowMixPixelsPerRow(
  config: ScreenConfig,
): Array<{ pixelsWide: number; pixelsHigh: number }> | null {
  const perStrip = rowMixPixelsPerStrip(config)
  return perStrip.find((rows) => rows != null) ?? null
}

/** Применить микс к одной полосе */
export function applyStripRowMixAt(
  config: ScreenConfig,
  stripIndex: number,
  bands: RowMixBand[],
): ScreenConfig {
  const stripCount = Math.max(1, config.stripWidths?.length ?? 1)
  const all = stripRowMixBandsFor(config, stripCount)
  if (stripIndex < 0 || stripIndex >= all.length) return config

  all[stripIndex] = normalizeRowMixBands(bands)
  return applyStripRowMixBands(config, all)
}

/** Применить микс ко всем полосам */
export function applyStripRowMixBands(
  config: ScreenConfig,
  stripBands: RowMixBand[][],
): ScreenConfig {
  const stripCount = Math.max(1, config.stripWidths?.length ?? 1)
  const normalized = normalizeStripRowMixBands(stripBands, stripCount)
  const heights = normalized.map((bands, i) =>
    isStripRowMixActive(bands)
      ? summarizeRowMix(bands).cabinetsHigh
      : (config.stripHeights?.[i] ?? config.cabinetsHigh),
  )
  const cabinetsHigh = Math.max(...heights, 1)
  const basePreset = getPitchPreset('3.9-small')!
  const anyMix = normalized.some((b) => isStripRowMixActive(b))
  const mixWallHeightM = anyMix
    ? Math.max(
        ...normalized
          .filter((b) => isStripRowMixActive(b))
          .map((b) => summarizeRowMix(b).wallHeightM),
      )
    : config.wallHeightM

  return {
    ...config,
    stripRowMixBands: normalized,
    rowMixBands: undefined,
    stripHeights: heights.map((h) => Math.max(1, h)),
    cabinetsHigh,
    wallHeightM: mixWallHeightM,
    ...(anyMix
      ? {
          cabinetWidthMm: basePreset.cabinetWidthMm,
          cabinetHeightMm: basePreset.cabinetHeightMm,
          pixelPitchMm: basePreset.pixelPitchMm,
          pitchPreset: 'custom' as const,
          customDensityInput: 'pixels' as const,
          customPixelsWide: basePreset.pixelsWide,
          customPixelsHigh: basePreset.pixelsHigh,
        }
      : {}),
  }
}

/** @deprecated — микс на полосу 0 */
export function applyRowMixBands(
  config: ScreenConfig,
  bands: RowMixBand[],
): ScreenConfig {
  return applyStripRowMixAt(config, 0, bands)
}

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
  const bigOnTop = firstBig || !firstSmall
  return { bigRows, smallRows, bigOnTop }
}

const BIG_H_MM = 1000
const SMALL_H_MM = 500

export function stripRowsForWallHeight(
  wallHeightM: number,
  cabinetHeightMm: number,
): number {
  const h = Math.max(100, cabinetHeightMm)
  return Math.max(1, Math.floor((wallHeightM * 1000) / h))
}

export function wallHeightFromRows(rows: number, cabinetHeightMm: number): number {
  return (rows * cabinetHeightMm) / 1000
}

export function suggestBigSmallMixForHeight(wallHeightM: number): {
  bigRows: number
  smallRows: number
  totalM: number
  exact: boolean
} | null {
  const heightMm = Math.round(wallHeightM * 1000)
  if (heightMm <= 0) return null
  const bigRows = Math.floor(heightMm / BIG_H_MM)
  const remainder = heightMm - bigRows * BIG_H_MM
  if (remainder === 0 && bigRows > 0) {
    return { bigRows, smallRows: 0, totalM: wallHeightM, exact: true }
  }
  if (remainder % SMALL_H_MM !== 0) return null
  const smallRows = remainder / SMALL_H_MM
  if (bigRows === 0 && smallRows === 0) return null
  return {
    bigRows,
    smallRows,
    totalM: (bigRows * BIG_H_MM + smallRows * SMALL_H_MM) / 1000,
    exact: true,
  }
}

export function isHalfMeterWallHeight(wallHeightM: number): boolean {
  const heightMm = Math.round(wallHeightM * 1000)
  return heightMm >= 500 && heightMm % 1000 === 500
}

export type RowMixHeightHint = {
  requestedM: number
  maxBigOnlyM: number
  bigRowsOnly: number
  halfMeter: boolean
  remainderM: number
  suggestion: NonNullable<ReturnType<typeof suggestBigSmallMixForHeight>>
}

export function needsRowMixHint(
  wallHeightM: number,
  cabinetHeightMm: number,
  rowMixActive: boolean,
  pitchPreset?: string,
): RowMixHeightHint | null {
  if (rowMixActive) return null
  const heightMm = Math.round(wallHeightM * 1000)
  if (heightMm < SMALL_H_MM) return null

  const suggestion = suggestBigSmallMixForHeight(wallHeightM)
  if (!suggestion || suggestion.smallRows === 0) return null

  const isBig =
    pitchPreset === '3.9-big' || cabinetHeightMm === BIG_H_MM
  const bigRowsOnly = Math.floor(heightMm / BIG_H_MM)
  const maxBigOnlyM = (bigRowsOnly * BIG_H_MM) / 1000
  const halfMeter = isHalfMeterWallHeight(wallHeightM)
  const remainderM = Math.max(0, wallHeightM - maxBigOnlyM)

  const uniformRows = stripRowsForWallHeight(wallHeightM, cabinetHeightMm)
  const uniformAchievedM = wallHeightFromRows(uniformRows, cabinetHeightMm)
  const exactWithCurrentPreset =
    Math.abs(uniformAchievedM - wallHeightM) < 0.001

  const needsMix = isBig
    ? heightMm > bigRowsOnly * BIG_H_MM
    : halfMeter && !exactWithCurrentPreset

  if (!needsMix) return null

  return {
    requestedM: wallHeightM,
    maxBigOnlyM,
    bigRowsOnly,
    halfMeter,
    remainderM,
    suggestion,
  }
}

/** Суммарная высота в px по вертикали (max по полосам с миксом) */
export function screenPixelsHighFromRowMix(config: ScreenConfig): number | null {
  const perStrip = stripRowMixBandsFor(config)
  let maxPx = 0
  let any = false
  for (const bands of perStrip) {
    if (!isStripRowMixActive(bands)) continue
    any = true
    maxPx = Math.max(maxPx, summarizeRowMix(bands!).pixelsHigh)
  }
  return any ? maxPx : null
}
