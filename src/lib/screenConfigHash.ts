import type { ManualRoutingOverrides, ScreenConfig, ScreenRoutingState } from '../types'
import { EMPTY_SCREEN_ROUTING } from '../types'
import { chainsKey } from './manualChains'

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
    screen.hangMount,
    screen.maxPowerPerCabinetW,
    screen.avgPowerPerCabinetW,
    screen.controllerModel,
    screen.trunkLengthM,
    screen.emptyCabinets.slice().sort().join(','),
    (screen.stripWidths ?? []).join(','),
    screen.dualVx1000 ? 1 : 0,
    (screen.stripControllerIds ?? []).join(','),
  ].join('|')
}

function sortedRecordKey(record: Record<string, number> | Record<number, string>): string {
  return Object.entries(record)
    .sort(([a], [b]) => String(a).localeCompare(String(b), undefined, { numeric: true }))
    .map(([k, v]) => `${k}:${v}`)
    .join(',')
}

export function routingOptionsKey(
  manualModeData: boolean,
  manualModePower: boolean,
  manualOverrides?: ManualRoutingOverrides,
): string {
  if (!manualModeData && !manualModePower) return 'auto'

  const dataKey =
    manualModeData && manualOverrides
      ? `data|${sortedRecordKey(manualOverrides.dataPorts)}|${sortedRecordKey(manualOverrides.dataStartPoints ?? {})}|${chainsKey(manualOverrides.dataPortChains)}`
      : 'auto-data'

  const powerKey =
    manualModePower && manualOverrides
      ? `power|${sortedRecordKey(manualOverrides.powerLines)}|${sortedRecordKey(manualOverrides.powerStartPoints ?? {})}|${chainsKey(manualOverrides.powerLineChains)}`
      : 'auto-power'

  return `manual|${dataKey}|${powerKey}`
}

export function fullRoutingKey(
  screen: ScreenConfig,
  routing: ScreenRoutingState,
): string {
  return `${screenRoutingKey(screen)}::${routingOptionsKey(
    routing.manualModeData,
    routing.manualModePower,
    routing.manualOverrides,
  )}`
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
