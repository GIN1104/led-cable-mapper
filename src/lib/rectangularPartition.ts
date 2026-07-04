import { getMaxCabinetsPerDataPort } from './constants'
import {
  getMaxCabinetsPerPowerLine,
  getPreferredCabinetsPerPowerLine,
} from './constants'
import type { ChainStartEdge, RefreshRate, ScreenConfig } from '../types'

/** Прямоугольный регион сетки кабинетов (непрерывный блок col×row) */
export interface RectRegion {
  colStart: number
  rowStart: number
  width: number
  height: number
}

/** Проверка активности ячейки (col, row); false = пропущенная ячейка */
export type CellActiveFn = (col: number, row: number) => boolean

/** Стратегия разбиения сетки — влияет на форму блоков */
export type PartitionStrategy = 'horizontal' | 'vertical' | 'balanced' | 'compact'

const ALL_STRATEGIES: PartitionStrategy[] = ['horizontal', 'vertical', 'balanced', 'compact']

/** Максимум кабинетов в одном блоке по лимиту пикселей на data-порт */
export function maxCabinetsPerBlock(
  pixelsPerCabinet: number,
  refreshRate: RefreshRate = 60,
): number {
  return getMaxCabinetsPerDataPort(refreshRate, pixelsPerCabinet)
}

/** Бонус за горизонтальные полосы (ширина ≥ высоты) */
function horizontalFlowBonus(width: number, height: number, weight: number): number {
  if (height <= 0) return 0
  const ratio = width / height
  return ratio >= 1 ? Math.min(ratio, 4) * weight : 0
}

/** Бонус за вертикальные полосы (высота ≥ ширины) */
function verticalFlowBonus(width: number, height: number, weight: number): number {
  if (width <= 0) return 0
  const ratio = height / width
  return ratio >= 1 ? Math.min(ratio, 4) * weight : 0
}

/** Чем ближе к 1, тем прямоугольник «квадратнее» */
function squareness(width: number, height: number): number {
  const ratio = width / height
  return Math.min(ratio, 1 / ratio)
}

function strategyWeights(strategy: PartitionStrategy): {
  horizontal: number
  vertical: number
  square: number
  fill: number
} {
  switch (strategy) {
    case 'horizontal':
      return { horizontal: 0.55, vertical: 0, square: 0.15, fill: 10 }
    case 'vertical':
      return { horizontal: 0, vertical: 0.55, square: 0.15, fill: 10 }
    case 'compact':
      return { horizontal: 0.1, vertical: 0.1, square: 0.6, fill: 12 }
    case 'balanced':
    default:
      return { horizontal: 0.35, vertical: 0.05, square: 0.25, fill: 10 }
  }
}

/** Считает активные ячейки в прямоугольном регионе */
function countActiveInRect(
  colStart: number,
  rowStart: number,
  width: number,
  height: number,
  isActive: CellActiveFn,
): number {
  let count = 0
  for (let r = rowStart; r < rowStart + height; r++) {
    for (let c = colStart; c < colStart + width; c++) {
      if (isActive(c, r)) count++
    }
  }
  return count
}

function preferredFillScore(area: number, preferredCabs: number): number {
  if (preferredCabs <= 0) return 0
  return 1 - Math.abs(area - preferredCabs) / preferredCabs
}

/**
 * Рекурсивно делит прямоугольник на подблоки, удовлетворяющие лимиту кабинетов.
 * Пустые ячейки не учитываются в площади.
 */
function partitionRect(
  colStart: number,
  rowStart: number,
  width: number,
  height: number,
  maxCabs: number,
  isActive: CellActiveFn,
  preferredCabs: number = maxCabs,
  strategy: PartitionStrategy = 'balanced',
): RectRegion[] {
  const area = countActiveInRect(colStart, rowStart, width, height, isActive)
  if (area === 0) return []
  if (area <= maxCabs) {
    return [{ colStart, rowStart, width, height }]
  }

  const weights = strategyWeights(strategy)

  type SplitCandidate = { type: 'v' | 'h'; k: number; score: number }
  const candidates: SplitCandidate[] = []

  const vMinK = Math.max(1, width - Math.floor(maxCabs / height))
  const vMaxK = Math.min(width - 1, Math.floor(maxCabs / height))
  for (let k = vMinK; k <= vMaxK; k++) {
    const leftArea = countActiveInRect(colStart, rowStart, k, height, isActive)
    const rightArea = countActiveInRect(colStart + k, rowStart, width - k, height, isActive)
    if (leftArea === 0 || rightArea === 0) continue
    if (leftArea > maxCabs || rightArea > maxCabs) continue

    const fillScore = preferredFillScore(leftArea, preferredCabs)
    const score =
      fillScore * weights.fill +
      squareness(k, height) * weights.square +
      squareness(width - k, height) * weights.square +
      horizontalFlowBonus(k, height, weights.horizontal) +
      horizontalFlowBonus(width - k, height, weights.horizontal) +
      verticalFlowBonus(k, height, weights.vertical) +
      verticalFlowBonus(width - k, height, weights.vertical) -
      Math.abs(leftArea - rightArea) * 0.001
    candidates.push({ type: 'v', k, score })
  }

  const hMinK = Math.max(1, height - Math.floor(maxCabs / width))
  const hMaxK = Math.min(height - 1, Math.floor(maxCabs / width))
  for (let k = hMinK; k <= hMaxK; k++) {
    const topArea = countActiveInRect(colStart, rowStart, width, k, isActive)
    const bottomArea = countActiveInRect(colStart, rowStart + k, width, height - k, isActive)
    if (topArea === 0 || bottomArea === 0) continue
    if (topArea > maxCabs || bottomArea > maxCabs) continue

    const fillScore = preferredFillScore(topArea, preferredCabs)
    const score =
      fillScore * weights.fill +
      squareness(width, k) * weights.square +
      squareness(width, height - k) * weights.square +
      horizontalFlowBonus(width, k, weights.horizontal) +
      horizontalFlowBonus(width, height - k, weights.horizontal) +
      verticalFlowBonus(width, k, weights.vertical) +
      verticalFlowBonus(width, height - k, weights.vertical) -
      Math.abs(topArea - bottomArea) * 0.001
    candidates.push({ type: 'h', k, score })
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score)
    const best = candidates[0]
    if (best.type === 'v') {
      return [
        ...partitionRect(colStart, rowStart, best.k, height, maxCabs, isActive, preferredCabs, strategy),
        ...partitionRect(colStart + best.k, rowStart, width - best.k, height, maxCabs, isActive, preferredCabs, strategy),
      ]
    }
    return [
      ...partitionRect(colStart, rowStart, width, best.k, maxCabs, isActive, preferredCabs, strategy),
      ...partitionRect(colStart, rowStart + best.k, width, height - best.k, maxCabs, isActive, preferredCabs, strategy),
    ]
  }

  if (width > 1) {
    const k = Math.floor(width / 2)
    return [
      ...partitionRect(colStart, rowStart, k, height, maxCabs, isActive, preferredCabs, strategy),
      ...partitionRect(colStart + k, rowStart, width - k, height, maxCabs, isActive, preferredCabs, strategy),
    ]
  }
  if (height > 1) {
    const k = Math.floor(height / 2)
    return [
      ...partitionRect(colStart, rowStart, width, k, maxCabs, isActive, preferredCabs, strategy),
      ...partitionRect(colStart, rowStart + k, width, height - k, maxCabs, isActive, preferredCabs, strategy),
    ]
  }

  return [{ colStart, rowStart, width, height }]
}

/** Нижняя граница региона (exclusive): большее значение = ниже на стене */
function regionBottomEdge(region: RectRegion): number {
  return region.rowStart + region.height
}

/**
 * Сортирует регионы снизу вверх; на одной нижней полосе — с края стены (левый или правый).
 */
export function sortRegionsBottomFirst(
  regions: RectRegion[],
  startEdge: ChainStartEdge = 'left',
): RectRegion[] {
  return [...regions].sort((a, b) => {
    const bottomDiff = regionBottomEdge(b) - regionBottomEdge(a)
    if (bottomDiff !== 0) return bottomDiff

    if (startEdge === 'right') {
      const rightA = a.colStart + a.width
      const rightB = b.colStart + b.width
      return rightB - rightA
    }
    return a.colStart - b.colStart
  })
}

/** Разбивает сетку на прямоугольные блоки с максимальным заполнением */
export function partitionGridByMaxCabinets(
  cabinetsWide: number,
  cabinetsHigh: number,
  maxCabs: number,
  startEdge: ChainStartEdge = 'left',
  isActive: CellActiveFn = () => true,
  preferredCabs: number = maxCabs,
  strategy: PartitionStrategy = 'balanced',
): RectRegion[] {
  const regions = partitionRect(
    0,
    0,
    cabinetsWide,
    cabinetsHigh,
    maxCabs,
    isActive,
    preferredCabs,
    strategy,
  )
  return sortRegionsBottomFirst(regions, startEdge)
}

/** Разбивает сетку на блоки с целевым заполнением preferredCabs, жёсткий потолок — maxCabs */
export function partitionGridByPreferredCabinets(
  cabinetsWide: number,
  cabinetsHigh: number,
  preferredCabs: number,
  maxCabs: number,
  startEdge: ChainStartEdge = 'left',
  isActive: CellActiveFn = () => true,
  strategy: PartitionStrategy = 'balanced',
): RectRegion[] {
  const regions = partitionRect(
    0,
    0,
    cabinetsWide,
    cabinetsHigh,
    maxCabs,
    isActive,
    preferredCabs,
    strategy,
  )
  return sortRegionsBottomFirst(regions, startEdge)
}

export interface PartitionPlan {
  strategy: PartitionStrategy
  dataRegions: RectRegion[]
  powerRegions: RectRegion[]
  score: number
}

/**
 * Перебирает стратегии разбиения и выбирает ту, где
 * dataPortCount + powerLineCount минимальны.
 */
export function findOptimalPartitionPlan(
  cabinetsWide: number,
  cabinetsHigh: number,
  pixelsPerCabinet: number,
  refreshRate: RefreshRate,
  config: ScreenConfig,
  isActive: CellActiveFn = () => true,
): PartitionPlan {
  const maxDataCabs = maxCabinetsPerBlock(pixelsPerCabinet, refreshRate)
  const maxPowerCabs = getMaxCabinetsPerPowerLine(config)
  const preferredPowerCabs = getPreferredCabinetsPerPowerLine(config)

  let best: PartitionPlan = {
    strategy: 'balanced',
    dataRegions: [],
    powerRegions: [],
    score: Infinity,
  }

  for (const strategy of ALL_STRATEGIES) {
    const dataRegions = partitionGridByMaxCabinets(
      cabinetsWide,
      cabinetsHigh,
      maxDataCabs,
      config.chainStartEdge,
      isActive,
      maxDataCabs,
      strategy,
    )
    const powerRegions = partitionGridByPreferredCabinets(
      cabinetsWide,
      cabinetsHigh,
      preferredPowerCabs,
      maxPowerCabs,
      config.chainStartEdge,
      isActive,
      strategy,
    )

    const score = dataRegions.length + powerRegions.length
    if (score < best.score) {
      best = { strategy, dataRegions, powerRegions, score }
    }
  }

  return best
}

/** Алиас для единого API оптимизатора разбиения */
export const computeOptimizedPartitions = findOptimalPartitionPlan

/** Автоматически разбивает всю стену на прямоугольные блоки для data-портов */
export function partitionGridIntoRectangles(
  cabinetsWide: number,
  cabinetsHigh: number,
  pixelsPerCabinet: number,
  refreshRate: RefreshRate = 60,
  startEdge: ChainStartEdge = 'left',
  isActive: CellActiveFn = () => true,
  strategy?: PartitionStrategy,
): RectRegion[] {
  const maxCabs = maxCabinetsPerBlock(pixelsPerCabinet, refreshRate)
  return partitionGridByMaxCabinets(
    cabinetsWide,
    cabinetsHigh,
    maxCabs,
    startEdge,
    isActive,
    maxCabs,
    strategy ?? 'balanced',
  )
}
