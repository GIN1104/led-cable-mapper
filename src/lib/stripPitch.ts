import type { PitchPresetId, ScreenConfig, ScreenId, StripPitchConfig } from '../types'
import { getPitchPreset } from './pitchPresets'

/** Число полос без импорта cabinetGrid (нет циклов) */
function stripCountFor(screen: ScreenConfig): number {
  const widths = screen.stripWidths
  if (!widths || widths.length === 0) return 1
  return Math.max(1, Math.min(widths.length, Math.max(1, screen.cabinetsWide)))
}

/** Разрешённая геометрия полосы (для сетки, routing и отрисовки) */
export interface ResolvedStripPitch {
  cabinetWidthMm: number
  cabinetHeightMm: number
  pixelPitchMm: number
  pitchPreset: PitchPresetId
  pixelsWide: number
  pixelsHigh: number
  totalPixels: number
  /** true — отличается от геометрии экрана */
  isOverride: boolean
}

export function inheritStripPitch(): StripPitchConfig {
  return { kind: 'inherit' }
}

function pixelsFromScreenLike(config: ScreenConfig): {
  pixelsWide: number
  pixelsHigh: number
  totalPixels: number
} {
  if (config.pitchPreset !== 'custom') {
    const preset = getPitchPreset(config.pitchPreset)
    if (preset) {
      return {
        pixelsWide: preset.pixelsWide,
        pixelsHigh: preset.pixelsHigh,
        totalPixels: preset.pixelsWide * preset.pixelsHigh,
      }
    }
  }
  if (config.customDensityInput === 'pixels') {
    const pixelsWide = config.customPixelsWide
    const pixelsHigh = config.customPixelsHigh
    return {
      pixelsWide,
      pixelsHigh,
      totalPixels: pixelsWide * pixelsHigh,
    }
  }
  if (config.densityMode === 'resolution') {
    const pixelsWide = Math.round(config.totalResolutionWidth / config.cabinetsWide)
    const pixelsHigh = Math.round(config.totalResolutionHeight / config.cabinetsHigh)
    return {
      pixelsWide,
      pixelsHigh,
      totalPixels: pixelsWide * pixelsHigh,
    }
  }
  const pixelsWide = Math.round(config.cabinetWidthMm / config.pixelPitchMm)
  const pixelsHigh = Math.round(config.cabinetHeightMm / config.pixelPitchMm)
  return {
    pixelsWide,
    pixelsHigh,
    totalPixels: pixelsWide * pixelsHigh,
  }
}

/** Нормализует массив питчей полос под число стрипов */
export function normalizeStripPitchConfigs(
  configs: StripPitchConfig[] | undefined,
  stripCount: number,
): StripPitchConfig[] {
  const n = Math.max(1, stripCount)
  const src = configs ?? []
  return Array.from({ length: n }, (_, i) => {
    const c = src[i]
    if (!c || c.kind === 'inherit') return inheritStripPitch()
    if (c.kind === 'preset') {
      return {
        kind: 'preset',
        pitchPreset: c.pitchPreset ?? '3.9-small',
        cabinetWidthMm: c.cabinetWidthMm,
        cabinetHeightMm: c.cabinetHeightMm,
        pixelPitchMm: c.pixelPitchMm,
        pixelsWide: c.pixelsWide,
        pixelsHigh: c.pixelsHigh,
      }
    }
    return {
      kind: 'screen',
      screenId: c.screenId,
      cabinetWidthMm: c.cabinetWidthMm,
      cabinetHeightMm: c.cabinetHeightMm,
      pixelPitchMm: c.pixelPitchMm,
      pixelsWide: c.pixelsWide,
      pixelsHigh: c.pixelsHigh,
      pitchPreset: c.pitchPreset,
    }
  })
}

/** Снимок геометрии с экрана-источника */
export function snapshotStripPitchFromScreen(source: ScreenConfig): Omit<
  StripPitchConfig,
  'kind' | 'screenId'
> & { pitchPreset: PitchPresetId } {
  const px = pixelsFromScreenLike(source)
  return {
    pitchPreset: source.pitchPreset,
    cabinetWidthMm: source.cabinetWidthMm,
    cabinetHeightMm: source.cabinetHeightMm,
    pixelPitchMm: source.pixelPitchMm,
    pixelsWide: px.pixelsWide,
    pixelsHigh: px.pixelsHigh,
  }
}

export function stripPitchFromPreset(presetId: PitchPresetId): StripPitchConfig {
  if (presetId === 'custom') {
    return { kind: 'preset', pitchPreset: 'custom' }
  }
  const preset = getPitchPreset(presetId)
  if (!preset) return inheritStripPitch()
  return {
    kind: 'preset',
    pitchPreset: presetId,
    cabinetWidthMm: preset.cabinetWidthMm,
    cabinetHeightMm: preset.cabinetHeightMm,
    pixelPitchMm: preset.pixelPitchMm,
    pixelsWide: preset.pixelsWide,
    pixelsHigh: preset.pixelsHigh,
  }
}

/** Свой размер кабинета на полосе (мм), пиксели из pitch */
export function stripPitchFromCustomSize(
  cabinetWidthMm: number,
  cabinetHeightMm: number,
  pixelPitchMm: number,
): StripPitchConfig {
  const w = Math.max(100, Math.round(cabinetWidthMm) || 500)
  const h = Math.max(100, Math.round(cabinetHeightMm) || 500)
  const pitch = Math.max(0.5, pixelPitchMm || 3.9)
  const pixelsWide = Math.round(w / pitch)
  const pixelsHigh = Math.round(h / pitch)
  return {
    kind: 'preset',
    pitchPreset: 'custom',
    cabinetWidthMm: w,
    cabinetHeightMm: h,
    pixelPitchMm: pitch,
    pixelsWide,
    pixelsHigh,
  }
}

export function stripPitchFromScreen(
  screenId: ScreenId,
  source: ScreenConfig,
): StripPitchConfig {
  return {
    kind: 'screen',
    screenId,
    ...snapshotStripPitchFromScreen(source),
  }
}

/** Обновляет снимки kind=screen из актуальных экранов проекта */
export function refreshStripPitchSnapshots(
  screen: ScreenConfig,
  allScreens: ScreenConfig[],
): ScreenConfig {
  const stripCount = stripCountFor(screen)
  const configs = normalizeStripPitchConfigs(screen.stripPitchConfigs, stripCount)
  let changed = false
  const next = configs.map((c) => {
    if (c.kind !== 'screen' || !c.screenId) return c
    const src = allScreens.find((s) => s.id === c.screenId)
    if (!src) return c
    const snap = snapshotStripPitchFromScreen(src)
    if (
      c.cabinetWidthMm === snap.cabinetWidthMm &&
      c.cabinetHeightMm === snap.cabinetHeightMm &&
      c.pixelPitchMm === snap.pixelPitchMm &&
      c.pixelsWide === snap.pixelsWide &&
      c.pixelsHigh === snap.pixelsHigh &&
      c.pitchPreset === snap.pitchPreset
    ) {
      return c
    }
    changed = true
    return { ...c, ...snap }
  })
  if (!changed) {
    const sameLen = (screen.stripPitchConfigs?.length ?? 0) === next.length
    const same =
      sameLen &&
      next.every((c, i) => {
        const prev = screen.stripPitchConfigs?.[i]
        return prev?.kind === c.kind && prev?.pitchPreset === c.pitchPreset && prev?.screenId === c.screenId
      })
    if (same && screen.stripPitchConfigs) return screen
  }
  return { ...screen, stripPitchConfigs: next }
}

export function resolveStripPitch(
  screen: ScreenConfig,
  stripIndex: number,
  allScreens: ScreenConfig[] = [],
): ResolvedStripPitch {
  const stripCount = stripCountFor(screen)
  const configs = normalizeStripPitchConfigs(screen.stripPitchConfigs, stripCount)
  const ref = configs[stripIndex] ?? inheritStripPitch()

  if (ref.kind === 'screen' && ref.screenId) {
    const live = allScreens.find((s) => s.id === ref.screenId)
    if (live) {
      const px = pixelsFromScreenLike(live)
      return {
        cabinetWidthMm: live.cabinetWidthMm,
        cabinetHeightMm: live.cabinetHeightMm,
        pixelPitchMm: live.pixelPitchMm,
        pitchPreset: live.pitchPreset,
        pixelsWide: px.pixelsWide,
        pixelsHigh: px.pixelsHigh,
        totalPixels: px.totalPixels,
        isOverride: true,
      }
    }
    if (ref.cabinetWidthMm && ref.cabinetHeightMm && ref.pixelsWide && ref.pixelsHigh) {
      return {
        cabinetWidthMm: ref.cabinetWidthMm,
        cabinetHeightMm: ref.cabinetHeightMm,
        pixelPitchMm: ref.pixelPitchMm ?? screen.pixelPitchMm,
        pitchPreset: ref.pitchPreset ?? screen.pitchPreset,
        pixelsWide: ref.pixelsWide,
        pixelsHigh: ref.pixelsHigh,
        totalPixels: ref.pixelsWide * ref.pixelsHigh,
        isOverride: true,
      }
    }
  }

  if (ref.kind === 'preset' && ref.pitchPreset && ref.pitchPreset !== 'custom') {
    const preset = getPitchPreset(ref.pitchPreset)
    if (preset) {
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
  }

  if (ref.kind === 'preset' && ref.pitchPreset === 'custom' && ref.cabinetWidthMm && ref.cabinetHeightMm) {
    const pitch = ref.pixelPitchMm ?? screen.pixelPitchMm
    const pw = ref.pixelsWide ?? Math.round(ref.cabinetWidthMm / pitch)
    const ph = ref.pixelsHigh ?? Math.round(ref.cabinetHeightMm / pitch)
    return {
      cabinetWidthMm: ref.cabinetWidthMm,
      cabinetHeightMm: ref.cabinetHeightMm,
      pixelPitchMm: pitch,
      pitchPreset: 'custom',
      pixelsWide: pw,
      pixelsHigh: ph,
      totalPixels: pw * ph,
      isOverride: true,
    }
  }

  const px = pixelsFromScreenLike(screen)
  return {
    cabinetWidthMm: screen.cabinetWidthMm,
    cabinetHeightMm: screen.cabinetHeightMm,
    pixelPitchMm: screen.pixelPitchMm,
    pitchPreset: screen.pitchPreset,
    pixelsWide: px.pixelsWide,
    pixelsHigh: px.pixelsHigh,
    totalPixels: px.totalPixels,
    isOverride: false,
  }
}

/** Геометрия каждой полосы экрана */
export function resolveAllStripPitches(
  screen: ScreenConfig,
  allScreens: ScreenConfig[] = [],
): ResolvedStripPitch[] {
  const n = stripCountFor(screen)
  return Array.from({ length: n }, (_, i) => resolveStripPitch(screen, i, allScreens))
}

/** ScreenConfig для расчёта одной полосы с её питчем */
export function stripScreenConfig(
  screen: ScreenConfig,
  stripIndex: number,
  stripWidthCols: number,
  allScreens: ScreenConfig[] = [],
): ScreenConfig {
  const geo = resolveStripPitch(screen, stripIndex, allScreens)
  return {
    ...screen,
    cabinetsWide: stripWidthCols,
    stripWidths: [stripWidthCols],
    stripPitchConfigs: [inheritStripPitch()],
    cabinetWidthMm: geo.cabinetWidthMm,
    cabinetHeightMm: geo.cabinetHeightMm,
    pixelPitchMm: geo.pixelPitchMm,
    pitchPreset: geo.pitchPreset,
    customPixelsWide: geo.pixelsWide,
    customPixelsHigh: geo.pixelsHigh,
    customDensityInput: geo.pitchPreset === 'custom' ? 'pixels' : screen.customDensityInput,
  }
}
