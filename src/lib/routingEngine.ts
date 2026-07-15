import type {

  RoutingOptions,

  RoutingResult,

  RoutingValidationWarning,

  ScreenConfig,

  ScreenRoutingState,

} from '../types'

import { EMPTY_SCREEN_ROUTING } from '../types'

import {

  calcPixelsPerCabinet,

  filterActiveCabinets,

  generateCabinetGrid,

  cabinetLabel,

} from './cabinetGrid'

import {

  assignmentsFromDataChains,

  buildBackupChains,

  buildDataChains,

  buildDataChainsFromManual,

  startPointsFromDataChains,
} from './dataRouting'

import {

  assignmentsFromPowerLines,

  buildPowerLines,

  buildPowerLinesFromManual,

  startPointsFromPowerLines,

  validatePowerLines,

} from './powerRouting'

import { buildRoutingSchema, buildCableSchedule } from './cableSchedule'

import { buildPackingList } from './packingList'

import type { CellActiveFn } from './rectangularPartition'



function emptySetFromConfig(config: ScreenConfig): Set<string> {

  return new Set(config.emptyCabinets)

}



function isActiveFromEmpty(emptySet: Set<string>, cabinetsHigh: number): CellActiveFn {

  return (col, row) => !emptySet.has(cabinetLabel(row, col, cabinetsHigh))

}



/** Главная функция расчёта — объединяет все модули маршрутизации */

export function computeRouting(

  config: ScreenConfig,

  options: RoutingOptions = {},

): RoutingResult {

  const allCabinets = generateCabinetGrid(config)

  const emptySet = emptySetFromConfig(config)

  const activeCabinets = filterActiveCabinets(allCabinets, emptySet)

  const isActive = isActiveFromEmpty(emptySet, config.cabinetsHigh)

  const { totalPixels: pixelsPerCabinet } = calcPixelsPerCabinet(config)

  const {
    manualModeData = false,
    manualModePower = false,
    manualOverrides,
  } = options



  let dataChains

  let dataLinks

  let dataWarnings: RoutingValidationWarning[] = []



  if (manualModeData && manualOverrides) {

    const manual = buildDataChainsFromManual(

      activeCabinets,

      manualOverrides.dataPorts,

      manualOverrides.dataStartPoints ?? {},

      config.refreshRate,

      pixelsPerCabinet,

      config.chainStartEdge,

      emptySet,

    )

    dataChains = manual.chains

    dataLinks = manual.links

    dataWarnings = manual.warnings

  } else {

    const auto = buildDataChains(activeCabinets, config, pixelsPerCabinet, isActive)

    dataChains = auto.chains

    dataLinks = auto.links

  }



  const backupResult = config.signalBackup

    ? buildBackupChains(dataChains)

    : { chains: [], links: [] }



  let powerLines

  let powerLinks

  let cabinetsPerLine

  let powerWarnings: RoutingValidationWarning[] = []



  if (manualModePower && manualOverrides) {

    const manual = buildPowerLinesFromManual(

      activeCabinets,

      manualOverrides.powerLines,

      config,

      manualOverrides.powerStartPoints ?? {},

      emptySet,

    )

    powerLines = manual.lines

    powerLinks = manual.links

    powerWarnings = manual.warnings

    cabinetsPerLine = powerLines.length > 0

      ? Math.max(...powerLines.map((l) => l.cabinets.length))

      : 0

  } else {

    const auto = buildPowerLines(activeCabinets, config, isActive, emptySet, pixelsPerCabinet)

    powerLines = auto.lines

    powerLinks = auto.links

    cabinetsPerLine = auto.cabinetsPerLine

    powerWarnings = validatePowerLines(powerLines, config)

  }



  const routingSchema = buildRoutingSchema(

    config,

    dataChains,

    backupResult.chains,

    powerLines,

  )



  const cableSchedule = buildCableSchedule(

    config,

    dataChains,

    backupResult.chains,

    powerLines,

    config.name,

  )



  const packingList = buildPackingList(config, cableSchedule, activeCabinets.length)

  const totalPixels = activeCabinets.reduce((sum, c) => sum + c.totalPixels, 0)



  return {

    cabinets: allCabinets,

    dataChains,

    backupChains: backupResult.chains,

    powerLines,

    dataLinks,

    backupLinks: backupResult.links,

    powerLinks,

    routingSchema,

    cableSchedule,

    packingList,

    summary: {

      totalCabinets: activeCabinets.length,

      totalPixels,

      dataPorts: dataChains.length,

      backupPorts: backupResult.chains.length,

      powerLines: powerLines.length,

      pixelsPerCabinet,

      cabinetsPerPowerLine: cabinetsPerLine,

      emptyCabinets: emptySet.size,

    },

    warnings: [...dataWarnings, ...powerWarnings],

  }

}



/** Строит полный набор ручных назначений из автоматического расчёта */

export function buildAutoManualOverrides(config: ScreenConfig) {

  const allCabinets = generateCabinetGrid(config)

  const emptySet = emptySetFromConfig(config)

  const activeCabinets = filterActiveCabinets(allCabinets, emptySet)

  const isActive = isActiveFromEmpty(emptySet, config.cabinetsHigh)

  const { totalPixels: pixelsPerCabinet } = calcPixelsPerCabinet(config)

  const { chains: dataChains } = buildDataChains(activeCabinets, config, pixelsPerCabinet, isActive)

  const { lines: powerLines } = buildPowerLines(
    activeCabinets,
    config,
    isActive,
    emptySet,
    pixelsPerCabinet,
  )



  const dataPorts = assignmentsFromDataChains(dataChains)

  const powerLineAssignments = assignmentsFromPowerLines(powerLines)



  return {

    dataPorts,

    powerLines: powerLineAssignments,

    dataStartPoints: startPointsFromDataChains(dataChains),

    powerStartPoints: startPointsFromPowerLines(powerLines),

  }

}



/** Расчёт маршрутизации для всех экранов проекта */

export function computeAllScreensRouting(

  screens: ScreenConfig[],

  routingByScreenId: Record<string, ScreenRoutingState>,

): Map<string, RoutingResult> {

  const results = new Map<string, RoutingResult>()

  for (const screen of screens) {

    const routing = routingByScreenId[screen.id] ?? EMPTY_SCREEN_ROUTING

    results.set(

      screen.id,

      computeRouting(screen, {

        manualModeData: routing.manualModeData,

        manualModePower: routing.manualModePower,

        manualOverrides:
          routing.manualModeData || routing.manualModePower
            ? routing.manualOverrides
            : undefined,

      }),

    )

  }

  return results

}


