import type {

  Cabinet,

  DataChain,

  GridLink,

  PowerLine,

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

  normalizeStripControllerIds,

  normalizeStripWidths,

  stripColumnRanges,

} from './cabinetGrid'

import {

  assignmentsFromDataChains,

  buildBackupChains,

  buildDataChains,

  buildDataChainsFromManual,

  orderedChainsFromDataChains,

  startPointsFromDataChains,
} from './dataRouting'

import {

  assignmentsFromPowerLines,

  buildPowerLines,

  buildPowerLinesFromManual,

  orderedChainsFromPowerLines,

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



/** Кабинеты полосы в локальных колонках 0…width-1 — те же правила упаковки, что у целой стены */
function remapStripCabinetsLocal(
  stripCabinets: Cabinet[],
  startCol: number,
): { local: Cabinet[]; byLabel: Map<string, Cabinet> } {
  const byLabel = new Map(stripCabinets.map((c) => [c.label, c]))
  const local = stripCabinets.map((c) => ({ ...c, col: c.col - startCol }))
  return { local, byLabel }
}

function restoreCabinet(byLabel: Map<string, Cabinet>, cab: Cabinet): Cabinet {
  return byLabel.get(cab.label) ?? cab
}

function restoreChainCabinets<T extends { cabinets: Cabinet[] }>(
  item: T,
  byLabel: Map<string, Cabinet>,
): T {
  return {
    ...item,
    cabinets: item.cabinets.map((c) => restoreCabinet(byLabel, c)),
  }
}

function restoreLinkCabinets(
  link: GridLink,
  byLabel: Map<string, Cabinet>,
): GridLink {
  return {
    ...link,
    from: restoreCabinet(byLabel, link.from),
    to: restoreCabinet(byLabel, link.to),
  }
}

/** Auto data: каждая полоса считается как отдельная стена по тем же правилам */
function buildDataChainsByStrips(
  activeCabinets: Cabinet[],
  config: ScreenConfig,
  pixelsPerCabinet: number,
  isActive: CellActiveFn,
): { chains: DataChain[]; links: GridLink[] } {
  const stripWidths = normalizeStripWidths(config.stripWidths, config.cabinetsWide)
  const ranges = stripColumnRanges(stripWidths)
  if (ranges.length <= 1) {
    return buildDataChains(activeCabinets, config, pixelsPerCabinet, isActive)
  }

  const dual = Boolean(config.dualVx1000) && stripWidths.length > 1
  const controllerIds = dual
    ? normalizeStripControllerIds(config.stripControllerIds, stripWidths.length)
    : null
  /** Локальный номер линии внутри каждого контроллера */
  const localCounters = new Map<number, number>()

  const chains: DataChain[] = []
  const links: GridLink[] = []
  let portOffset = 0

  for (let stripIdx = 0; stripIdx < ranges.length; stripIdx++) {
    const { startCol, endCol, width } = ranges[stripIdx]
    const stripCabinets = activeCabinets.filter(
      (c) => c.col >= startCol && c.col < endCol,
    )
    if (stripCabinets.length === 0) continue

    const { local, byLabel } = remapStripCabinetsLocal(stripCabinets, startCol)
    const stripConfig: ScreenConfig = {
      ...config,
      cabinetsWide: width,
      stripWidths: [width],
    }
    const stripIsActive: CellActiveFn = (col, row) =>
      col >= 0 && col < width && isActive(col + startCol, row)

    const auto = buildDataChains(
      local,
      stripConfig,
      pixelsPerCabinet,
      stripIsActive,
    )
    const controllerId = controllerIds?.[stripIdx] ?? 1
    for (const chain of auto.chains) {
      const restored = restoreChainCabinets(chain, byLabel)
      const portNumber = chain.portNumber + portOffset
      if (dual) {
        const localNumber = (localCounters.get(controllerId) ?? 0) + 1
        localCounters.set(controllerId, localNumber)
        chains.push({
          ...restored,
          portNumber,
          controllerId,
          localNumber,
          displayId: `${controllerId}-${localNumber}`,
        })
      } else {
        chains.push({ ...restored, portNumber })
      }
    }
    for (const link of auto.links) {
      links.push({
        ...restoreLinkCabinets(link, byLabel),
        chainId: link.chainId + portOffset,
      })
    }
    const maxPort = auto.chains.reduce(
      (m, c) => Math.max(m, c.portNumber),
      0,
    )
    portOffset += maxPort
  }

  return { chains, links }
}

/** Auto power: каждая полоса считается как отдельная стена по тем же правилам */
function buildPowerLinesByStrips(
  activeCabinets: Cabinet[],
  config: ScreenConfig,
  isActive: CellActiveFn,
  emptySet: Set<string>,
  pixelsPerCabinet: number,
): { lines: PowerLine[]; links: GridLink[]; cabinetsPerLine: number } {
  const stripWidths = normalizeStripWidths(config.stripWidths, config.cabinetsWide)
  const ranges = stripColumnRanges(stripWidths)
  if (ranges.length <= 1) {
    return buildPowerLines(
      activeCabinets,
      config,
      isActive,
      emptySet,
      pixelsPerCabinet,
    )
  }

  const dual = Boolean(config.dualVx1000) && stripWidths.length > 1
  const controllerIds = dual
    ? normalizeStripControllerIds(config.stripControllerIds, stripWidths.length)
    : null
  const localCounters = new Map<number, number>()

  const lines: PowerLine[] = []
  const links: GridLink[] = []
  let lineOffset = 0
  let cabinetsPerLine = 0

  for (let stripIdx = 0; stripIdx < ranges.length; stripIdx++) {
    const { startCol, endCol, width } = ranges[stripIdx]
    const stripCabinets = activeCabinets.filter(
      (c) => c.col >= startCol && c.col < endCol,
    )
    if (stripCabinets.length === 0) continue

    const { local, byLabel } = remapStripCabinetsLocal(stripCabinets, startCol)
    const stripConfig: ScreenConfig = {
      ...config,
      cabinetsWide: width,
      stripWidths: [width],
    }
    const stripIsActive: CellActiveFn = (col, row) =>
      col >= 0 && col < width && isActive(col + startCol, row)

    // emptySet по глобальным label — без изменений
    const auto = buildPowerLines(
      local,
      stripConfig,
      stripIsActive,
      emptySet,
      pixelsPerCabinet,
    )
    cabinetsPerLine = Math.max(cabinetsPerLine, auto.cabinetsPerLine)
    const controllerId = controllerIds?.[stripIdx] ?? 1
    for (const line of auto.lines) {
      const restored = restoreChainCabinets(line, byLabel)
      const lineNumber = line.lineNumber + lineOffset
      if (dual) {
        const localNumber = (localCounters.get(controllerId) ?? 0) + 1
        localCounters.set(controllerId, localNumber)
        lines.push({
          ...restored,
          lineNumber,
          controllerId,
          localNumber,
          displayId: `${controllerId}-${localNumber}`,
        })
      } else {
        lines.push({ ...restored, lineNumber })
      }
    }
    for (const link of auto.links) {
      links.push({
        ...restoreLinkCabinets(link, byLabel),
        chainId: link.chainId + lineOffset,
      })
    }
    const maxLine = auto.lines.reduce(
      (m, l) => Math.max(m, l.lineNumber),
      0,
    )
    lineOffset += maxLine
  }

  return { lines, links, cabinetsPerLine }
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

      manualOverrides.dataPortChains,

    )

    dataChains = manual.chains

    dataLinks = manual.links

    dataWarnings = manual.warnings

  } else {

    const auto = buildDataChainsByStrips(
      activeCabinets,
      config,
      pixelsPerCabinet,
      isActive,
    )

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

      manualOverrides.powerLineChains,

    )

    powerLines = manual.lines

    powerLinks = manual.links

    powerWarnings = manual.warnings

    cabinetsPerLine = powerLines.length > 0

      ? Math.max(...powerLines.map((l) => l.cabinets.length))

      : 0

  } else {

    const auto = buildPowerLinesByStrips(
      activeCabinets,
      config,
      isActive,
      emptySet,
      pixelsPerCabinet,
    )

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

  const { chains: dataChains } = buildDataChainsByStrips(
    activeCabinets,
    config,
    pixelsPerCabinet,
    isActive,
  )

  const { lines: powerLines } = buildPowerLinesByStrips(
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

    dataPortChains: orderedChainsFromDataChains(dataChains),

    powerLineChains: orderedChainsFromPowerLines(powerLines),

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


