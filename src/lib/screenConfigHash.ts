import type { ManualRoutingOverrides, ScreenConfig, ScreenRoutingState } from '../types'
import { EMPTY_SCREEN_ROUTING } from '../types'

/** Стабильный ключ конфигурации для мемоизации маршрутизации */
export function screenRoutingKey(screen: ScreenConfig): string {
  return [
    screen.id,
    screen.cabinetsWide,
    screen.cabinetsHigh,
    screen.wallWidthM,
    screen.wallHeightM,
    screen.pitchPreset,
    screen.cabinetWidthMm,
    screen.cabinetHeightMm,
    screen.pixelPitchMm,
    screen.customDensityInput,
    screen.customPixelsWide,
    screen.customPixelsHigh,
    screen.refreshRate,
    screen.signalBackup,
    screen.chainStartEdge,
    screen.powerFeedMode,
    screen.maxPowerPerCabinetW,
    screen.avgPowerPerCabinetW,
    screen.controllerModel,
    screen.trunkLengthM,
    screen.emptyCabinets.slice().sort().join(','),
  ].join('|')
}

export function routingOptionsKey(
  manualMode: boolean,
  manualOverrides?: ManualRoutingOverrides,
): string {
  if (!manualMode || !manualOverrides) return 'auto'
  const dataPorts = Object.entries(manualOverrides.dataPorts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join(',')
  const powerLines = Object.entries(manualOverrides.powerLines)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join(',')
  const dataStarts = Object.entries(manualOverrides.dataStartPoints ?? {})
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([k, v]) => `${k}:${v}`)
    .join(',')
  const powerStarts = Object.entries(manualOverrides.powerStartPoints ?? {})
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([k, v]) => `${k}:${v}`)
    .join(',')
  return `manual|${dataPorts}|${powerLines}|${dataStarts}|${powerStarts}`
}

export function fullRoutingKey(
  screen: ScreenConfig,
  routing: ScreenRoutingState,
): string {
  return `${screenRoutingKey(screen)}::${routingOptionsKey(routing.manualMode, routing.manualOverrides)}`
}

/** Ключ маршрутизации для всех экранов — для мемоизации сводного расчёта */
export function allScreensRoutingKey(
  screens: ScreenConfig[],
  routingByScreen: Record<string, ScreenRoutingState>,
): string {
  return screens
    .map((screen) =>
      fullRoutingKey(screen, routingByScreen[screen.id] ?? EMPTY_SCREEN_ROUTING),
    )
    .join('||')
}

/** Порог «большой сетки» для упрощённого рендера и индикатора загрузки */
export function isLargeGrid(screen: ScreenConfig): boolean {
  return screen.cabinetsWide * screen.cabinetsHigh >= 100
}
