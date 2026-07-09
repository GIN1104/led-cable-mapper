import type {
  Cabinet,
  ChainStartEdge,
  DataChain,
  GridLink,
  RefreshRate,
  RoutingValidationWarning,
  ScreenConfig,
} from '../types'
import {
  getMaxCabinetsPerDataPort,
  getMaxPixelsPerDataPort,
} from './constants'
import {
  inferChainStart,
  linkDirection,
  orderCabinetsFromStartSnake,
  orderRegionBySnake,
} from './cabinetGrid'
import type { CellActiveFn, PartitionStrategy, RectRegion } from './rectangularPartition'
import {
  maxCabinetsPerBlock,
  partitionGridByMaxCabinets,
  sortRegionsBottomFirst,
} from './rectangularPartition'

function buildLinksForChain(
  cabinets: Cabinet[],
  portNumber: number,
  type: 'data' | 'data-backup',
): GridLink[] {
  const links: GridLink[] = []
  for (let i = 0; i < cabinets.length - 1; i++) {
    links.push({
      from: cabinets[i],
      to: cabinets[i + 1],
      type,
      chainId: portNumber,
      direction: linkDirection(cabinets[i], cabinets[i + 1]),
    })
  }
  return links
}

/**
 * Обход data-блока: снизу вверх по рядам, в каждом ряду — LTR/RTL от chainStartEdge (змейка).
 * Не column-first: линия идёт горизонтально вдоль ряда, между рядами — короткий вертикальный переход.
 */
export function orderDataBlockHorizontalFirst(
  cabinets: Cabinet[],
  region: RectRegion,
  startEdge: ChainStartEdge,
): Cabinet[] {
  return orderRegionBySnake(
    cabinets,
    region.colStart,
    region.rowStart,
    region.width,
    region.height,
    startEdge,
  )
}

function cabinetsInRegion(
  cabinets: Cabinet[],
  region: RectRegion,
  startEdge: ChainStartEdge,
  emptySet?: Set<string>,
): Cabinet[] {
  const inRegion = cabinets.filter(
    (c) =>
      c.col >= region.colStart &&
      c.col < region.colStart + region.width &&
      c.row >= region.rowStart &&
      c.row < region.rowStart + region.height &&
      !(emptySet?.has(c.label)),
  )
  return orderDataBlockHorizontalFirst(inRegion, region, startEdge)
}

function buildChainsFromPortGroups(
  portGroups: Map<number, Cabinet[]>,
  startPoints: Record<number, string> = {},
  startEdge: ChainStartEdge = 'left',
): { chains: DataChain[]; links: GridLink[] } {
  const chains: DataChain[] = []
  const links: GridLink[] = []
  const portNumbers = [...portGroups.keys()].sort((a, b) => a - b)

  for (const portNumber of portNumbers) {
    const ordered = orderCabinetsFromStartSnake(
      portGroups.get(portNumber) ?? [],
      startPoints[portNumber],
      startEdge,
    )
    if (ordered.length === 0) continue

    const totalPixels = ordered.reduce((sum, c) => sum + c.totalPixels, 0)
    chains.push({
      portNumber,
      cabinets: ordered,
      totalPixels,
      isBackup: false,
    })
    links.push(...buildLinksForChain(ordered, portNumber, 'data'))
  }

  return { chains, links }
}

/** Считает активные ячейки в горизонтальном отрезке одного ряда */
function countActiveInRowSpan(
  row: number,
  colStart: number,
  width: number,
  isActive: CellActiveFn,
): number {
  let count = 0
  for (let c = colStart; c < colStart + width; c++) {
    if (isActive(c, row)) count++
  }
  return count
}

/** Целевой размер горизонтального сегмента при переполненном ряду */
function balancedSegmentTarget(activeCount: number, maxCabs: number): number {
  if (activeCount <= maxCabs) return maxCabs
  const numSegments = Math.ceil(activeCount / maxCabs)
  return Math.ceil(activeCount / numSegments)
}

/** Горизонтальный отрезок ряда, содержащий (col, row) */
function horizontalRunAt(
  col: number,
  row: number,
  cabinetsWide: number,
  isActive: CellActiveFn,
): { colStart: number; width: number; activeCount: number } | null {
  if (!isActive(col, row)) return null

  let colStart = col
  while (colStart > 0 && isActive(colStart - 1, row)) colStart--

  let colEnd = col
  while (colEnd + 1 < cabinetsWide && isActive(colEnd + 1, row)) colEnd++

  const width = colEnd - colStart + 1
  return {
    colStart,
    width,
    activeCount: countActiveInRowSpan(row, colStart, width, isActive),
  }
}

/** Считает активные ячейки в прямоугольнике, все ячейки должны быть в uncovered */
function countUncoveredInRect(
  colStart: number,
  rowStart: number,
  width: number,
  height: number,
  isActive: CellActiveFn,
  uncovered: Set<string>,
): number {
  let count = 0
  for (let r = rowStart; r < rowStart + height; r++) {
    for (let c = colStart; c < colStart + width; c++) {
      const key = `${c},${r}`
      if (!uncovered.has(key) || !isActive(c, r)) return -1
      count++
    }
  }
  return count
}

/** Оставшиеся непокрытые активные ячейки в отрезке ряда [colStart, colEnd) */
function remainingActiveInRowSpan(
  row: number,
  colStart: number,
  colEndExclusive: number,
  isActive: CellActiveFn,
  uncovered: Set<string>,
): number {
  let count = 0
  for (let c = colStart; c < colEndExclusive; c++) {
    const key = `${c},${row}`
    if (uncovered.has(key) && isActive(c, row)) count++
  }
  return count
}

/**
 * Оценка формы data-блока: при равном числе кабинетов предпочитаем
 * горизонтальные полосы (width ≥ height), полные ряды и большую ширину.
 */
function scoreDataRegionShape(width: number, height: number, count: number): number {
  let score = count * 1_000_000
  if (height === 1) score += 80_000
  if (width >= height) {
    score += 40_000 + Math.min(width / height, 6) * 5_000
  } else {
    score -= 30_000 * Math.min(height / width, 4)
  }
  score += width * 200
  score -= height * 100
  return score
}

function isBetterDataRegion(
  width: number,
  height: number,
  count: number,
  bestWidth: number,
  bestHeight: number,
  bestCount: number,
): boolean {
  const score = scoreDataRegionShape(width, height, count)
  const bestScore = scoreDataRegionShape(bestWidth, bestHeight, bestCount)
  return score > bestScore
}

/**
 * Выбирает максимальный прямоугольник с нижним левым углом в (anchorCol, anchorRow).
 * row 0 — верх стены, больший row — ниже; блок растёт вверх по стене.
 * Сначала расширяет блок по ряду (горизонтально), затем наращивает высоту.
 */
function pickBestRegionAt(
  anchorCol: number,
  anchorRow: number,
  cabinetsWide: number,
  maxCabs: number,
  isActive: CellActiveFn,
  uncovered: Set<string>,
): RectRegion {
  const run = horizontalRunAt(anchorCol, anchorRow, cabinetsWide, isActive)
  const remainingInRun =
    run != null
      ? remainingActiveInRowSpan(
          anchorRow,
          anchorCol,
          run.colStart + run.width,
          isActive,
          uncovered,
        )
      : 0

  // Весь оставшийся горизонтальный ряд влезает в порт — берём целиком
  if (remainingInRun > 0 && remainingInRun <= maxCabs && run && anchorCol === run.colStart) {
    return {
      colStart: run.colStart,
      rowStart: anchorRow,
      width: run.width,
      height: 1,
    }
  }

  let best = { width: 1, height: 1, count: 0 }

  const maxHeight = anchorRow + 1
  const maxWidth = cabinetsWide - anchorCol

  const singleRowSegmentTarget =
    remainingInRun > maxCabs
      ? balancedSegmentTarget(remainingInRun, maxCabs)
      : maxCabs

  // Горизонтально-первая упаковка: ширина (от большей к меньшей), затем высота
  for (let h = 1; h <= maxHeight; h++) {
    const regionRowStart = anchorRow - h + 1
    for (let w = maxWidth; w >= 1; w--) {
      const count = countUncoveredInRect(
        anchorCol,
        regionRowStart,
        w,
        h,
        isActive,
        uncovered,
      )
      if (count < 0) continue
      if (count > maxCabs) continue
      // Data идёт по рядам — не допускаем вертикально-доминантные блоки
      if (h > w) continue

      if (h === 1 && remainingInRun > maxCabs) {
        const rowOnlyCount = remainingActiveInRowSpan(
          anchorRow,
          anchorCol,
          anchorCol + w,
          isActive,
          uncovered,
        )
        if (rowOnlyCount > singleRowSegmentTarget) continue
      }

      if (isBetterDataRegion(w, h, count, best.width, best.height, best.count)) {
        best = { width: w, height: h, count }
      }
    }
  }

  // Узкий хвост: вертикальный блок только если горизонтальный не нашёлся
  if (best.count === 0) {
    for (let h = 1; h <= maxHeight; h++) {
      const regionRowStart = anchorRow - h + 1
      for (let w = maxWidth; w >= 1; w--) {
        const count = countUncoveredInRect(
          anchorCol,
          regionRowStart,
          w,
          h,
          isActive,
          uncovered,
        )
        if (count < 0) continue
        if (count > maxCabs) continue
        if (isBetterDataRegion(w, h, count, best.width, best.height, best.count)) {
          best = { width: w, height: h, count }
        }
      }
    }
  }

  return {
    colStart: anchorCol,
    rowStart: anchorRow - best.height + 1,
    width: best.width,
    height: best.height,
  }
}

/** Проверяет полное покрытие активных ячеек регионами без перекрытий */
function regionsCoverGrid(
  regions: RectRegion[],
  cabinetsWide: number,
  cabinetsHigh: number,
  isActive: CellActiveFn,
): boolean {
  const covered = new Set<string>()
  for (const region of regions) {
    for (let r = region.rowStart; r < region.rowStart + region.height; r++) {
      for (let c = region.colStart; c < region.colStart + region.width; c++) {
        const key = `${c},${r}`
        if (!isActive(c, r) || covered.has(key)) return false
        covered.add(key)
      }
    }
  }
  for (let r = 0; r < cabinetsHigh; r++) {
    for (let c = 0; c < cabinetsWide; c++) {
      if (isActive(c, r) && !covered.has(`${c},${r}`)) return false
    }
  }
  return true
}

/** Суммарный бонус за горизонтальные полосы во всех регионах плана */
function planHorizontalScore(regions: RectRegion[]): number {
  return regions.reduce(
    (sum, r) => sum + scoreDataRegionShape(r.width, r.height, r.width * r.height),
    0,
  )
}

function greedyPartition(
  cabinetsWide: number,
  cabinetsHigh: number,
  maxCabs: number,
  isActive: CellActiveFn,
): RectRegion[] {
  const uncovered = new Set<string>()
  for (let r = 0; r < cabinetsHigh; r++) {
    for (let c = 0; c < cabinetsWide; c++) {
      if (isActive(c, r)) uncovered.add(`${c},${r}`)
    }
  }

  const regions: RectRegion[] = []
  while (uncovered.size > 0) {
    let anchorCol = cabinetsWide
    let anchorRow = -1
    for (const key of uncovered) {
      const [c, row] = key.split(',').map(Number)
      if (row > anchorRow || (row === anchorRow && c < anchorCol)) {
        anchorCol = c
        anchorRow = row
      }
    }

    const region = pickBestRegionAt(
      anchorCol,
      anchorRow,
      cabinetsWide,
      maxCabs,
      isActive,
      uncovered,
    )
    regions.push(region)
    for (let dr = 0; dr < region.height; dr++) {
      for (let dc = 0; dc < region.width; dc++) {
        uncovered.delete(`${region.colStart + dc},${region.rowStart + dr}`)
      }
    }
  }
  return regions
}

/**
 * Жадная упаковка data-портов с минимизацией числа портов.
 * Пробует жадный обход и grid-стратегии, выбирает план с минимумом портов.
 */
export function partitionDataGreedyMinPorts(
  cabinetsWide: number,
  cabinetsHigh: number,
  pixelsPerCabinet: number,
  refreshRate: RefreshRate,
  isActive: CellActiveFn = () => true,
  startEdge: ChainStartEdge = 'left',
): RectRegion[] {
  const maxCabs = maxCabinetsPerBlock(pixelsPerCabinet, refreshRate)

  const candidates: RectRegion[][] = [
    greedyPartition(cabinetsWide, cabinetsHigh, maxCabs, isActive),
  ]

  // Grid-стратегии — запасной вариант, если жадная даёт больше портов
  const strategies: PartitionStrategy[] = ['horizontal', 'balanced', 'compact']
  for (const strategy of strategies) {
    candidates.push(
      partitionGridByMaxCabinets(
        cabinetsWide,
        cabinetsHigh,
        maxCabs,
        startEdge,
        isActive,
        maxCabs,
        strategy,
      ),
    )
  }

  const valid = candidates.filter((regions) =>
    regionsCoverGrid(regions, cabinetsWide, cabinetsHigh, isActive),
  )
  const pool = valid.length > 0 ? valid : candidates
  const minPorts = Math.min(...pool.map((r) => r.length))
  const tied = pool.filter((r) => r.length === minPorts)
  const best = tied.reduce((a, b) =>
    planHorizontalScore(a) >= planHorizontalScore(b) ? a : b,
  )

  return sortRegionsBottomFirst(best, startEdge)
}

/**
 * @deprecated Используйте partitionDataGreedyMinPorts — старый алгоритм давал лишние порты.
 * Оставлен для совместимости тестов; делегирует в жадную упаковку.
 */
export function partitionDataByHorizontalRows(
  cabinetsWide: number,
  cabinetsHigh: number,
  pixelsPerCabinet: number,
  refreshRate: RefreshRate,
  isActive: CellActiveFn = () => true,
): RectRegion[] {
  return partitionDataGreedyMinPorts(
    cabinetsWide,
    cabinetsHigh,
    pixelsPerCabinet,
    refreshRate,
    isActive,
  )
}

/** Проверяет лимиты data-портов и возвращает предупреждения */
export function validateDataChains(
  chains: DataChain[],
  refreshRate: RefreshRate = 60,
  pixelsPerCabinet: number,
): RoutingValidationWarning[] {
  const maxPixels = getMaxPixelsPerDataPort(refreshRate)
  const maxCabinets = getMaxCabinetsPerDataPort(refreshRate, pixelsPerCabinet)
  const warnings: RoutingValidationWarning[] = []
  for (const chain of chains) {
    if (chain.cabinets.length > maxCabinets) {
      warnings.push({
        type: 'data',
        id: chain.portNumber,
        message: `D${chain.portNumber}: ${chain.cabinets.length} cabinets (max ${maxCabinets} @ ${refreshRate}Hz)`,
      })
    }
    if (chain.totalPixels > maxPixels) {
      warnings.push({
        type: 'data',
        id: chain.portNumber,
        message: `D${chain.portNumber}: ${chain.totalPixels.toLocaleString()} px (max ${maxPixels.toLocaleString()} @ ${refreshRate}Hz)`,
      })
    }
  }
  return warnings
}

/**
 * Авто-разбиение: жадная упаковка с минимумом портов (D1 = нижний блок).
 * Внутри блока — змейка снизу вверх; ряды объединяются, если влезают в лимит.
 */
export function buildDataChains(
  cabinets: Cabinet[],
  config: ScreenConfig,
  pixelsPerCabinet: number,
  isActive: CellActiveFn = () => true,
  emptySet?: Set<string>,
): { chains: DataChain[]; links: GridLink[] } {
  const dataRegions = partitionDataGreedyMinPorts(
    config.cabinetsWide,
    config.cabinetsHigh,
    pixelsPerCabinet,
    config.refreshRate,
    isActive,
    config.chainStartEdge,
  )

  const chains: DataChain[] = []
  const links: GridLink[] = []

  dataRegions.forEach((region, index) => {
    const portNumber = index + 1
    const ordered = cabinetsInRegion(cabinets, region, config.chainStartEdge, emptySet)
    if (ordered.length === 0) return

    const totalPixels = ordered.reduce((sum, c) => sum + c.totalPixels, 0)
    chains.push({
      portNumber,
      cabinets: ordered,
      totalPixels,
      isBackup: false,
    })
    links.push(...buildLinksForChain(ordered, portNumber, 'data'))
  })

  return { chains, links }
}

/** Строит data-цепочки из ручных назначений портов */
export function buildDataChainsFromManual(
  cabinets: Cabinet[],
  assignments: Record<string, number>,
  startPoints: Record<number, string> = {},
  refreshRate: RefreshRate = 60,
  pixelsPerCabinet: number,
  startEdge: ChainStartEdge = 'left',
  emptySet?: Set<string>,
): { chains: DataChain[]; links: GridLink[]; warnings: RoutingValidationWarning[] } {
  const portGroups = new Map<number, Cabinet[]>()

  for (const cab of cabinets) {
    const port = assignments[cab.label]
    if (port == null || port < 1) continue
    if (emptySet?.has(cab.label)) continue
    const group = portGroups.get(port) ?? []
    group.push(cab)
    portGroups.set(port, group)
  }

  const { chains, links } = buildChainsFromPortGroups(portGroups, startPoints, startEdge)
  return { chains, links, warnings: validateDataChains(chains, refreshRate, pixelsPerCabinet) }
}

/** Строит резервные цепочки (обратный порядок для каждого основного порта) */
export function buildBackupChains(dataChains: DataChain[]): {
  chains: DataChain[]
  links: GridLink[]
} {
  const chains: DataChain[] = []
  const links: GridLink[] = []

  for (const main of dataChains) {
    const reversed = [...main.cabinets].reverse()
    const backupPort = main.portNumber

    chains.push({
      portNumber: backupPort,
      cabinets: reversed,
      totalPixels: main.totalPixels,
      isBackup: true,
      backupForPort: main.portNumber,
    })

    links.push(...buildLinksForChain(reversed, backupPort, 'data-backup'))
  }

  return { chains, links }
}

/** Старт data-цепочки по умолчанию: нижний ряд, край по chainStartEdge */
export function inferDataChainStart(
  cabinets: Cabinet[],
  startEdge: ChainStartEdge = 'left',
): string | undefined {
  return inferChainStart(cabinets, startEdge)
}

/** Извлекает точки старта из автоматически рассчитанных цепочек */
export function startPointsFromDataChains(chains: DataChain[]): Record<number, string> {
  const map: Record<number, string> = {}
  for (const chain of chains) {
    if (chain.cabinets.length > 0) {
      map[chain.portNumber] = chain.cabinets[0].label
    }
  }
  return map
}

/** Извлекает назначения портов из автоматически рассчитанных цепочек */
export function assignmentsFromDataChains(chains: DataChain[]): Record<string, number> {
  const map: Record<string, number> = {}
  for (const chain of chains) {
    for (const cab of chain.cabinets) {
      map[cab.label] = chain.portNumber
    }
  }
  return map
}

/** Алиас для routingEngine / UI */
export const buildManualDataChains = buildDataChainsFromManual
