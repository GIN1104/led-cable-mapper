import type { Cabinet, ChainStartEdge, LineDirection, PitchPresetId, ScreenConfig } from '../types'
import { getPitchPreset } from './pitchPresets'

/** left = LTR (слева направо), right = RTL (справа налево) */
export function edgeToDirection(edge: ChainStartEdge): LineDirection {
  return edge === 'left' ? 'ltr' : 'rtl'
}

export function directionToEdge(direction: LineDirection): ChainStartEdge {
  return direction === 'ltr' ? 'left' : 'right'
}

/** Считает количество кабинетов по размеру стены в метрах */
export function calcCabinetsFromMeters(
  wallWidthM: number,
  wallHeightM: number,
  cabinetWidthMm: number,
  cabinetHeightMm: number,
): { cabinetsWide: number; cabinetsHigh: number } {
  const cabinetsWide =
    wallWidthM > 0
      ? Math.max(1, Math.floor((wallWidthM * 1000) / cabinetWidthMm))
      : 1
  const cabinetsHigh =
    wallHeightM > 0
      ? Math.max(1, Math.floor((wallHeightM * 1000) / cabinetHeightMm))
      : 1
  return { cabinetsWide, cabinetsHigh }
}

/** Пересчитывает cabinetsWide/High из wallWidthM/wallHeightM и размеров кабинета */
export function syncCabinetGridFromMeters(config: ScreenConfig): ScreenConfig {
  const { cabinetsWide, cabinetsHigh } = calcCabinetsFromMeters(
    config.wallWidthM,
    config.wallHeightM,
    config.cabinetWidthMm,
    config.cabinetHeightMm,
  )
  if (cabinetsWide === config.cabinetsWide && cabinetsHigh === config.cabinetsHigh) {
    return config
  }
  return { ...config, cabinetsWide, cabinetsHigh }
}

/** Преобразует индекс строки в букву (0 → A, 1 → B, …) */
export function rowIndexToLetter(index: number): string {
  let n = index
  let result = ''
  do {
    result = String.fromCharCode(65 + (n % 26)) + result
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return result
}

/** Рассчитывает пиксели на одну кабинетку */
export function calcPixelsPerCabinet(config: ScreenConfig): {
  pixelsWide: number
  pixelsHigh: number
  totalPixels: number
} {
  const { cabinetsWide, cabinetsHigh, cabinetWidthMm, cabinetHeightMm } = config

  // Пресет — точные значения из конфигурации, без пересчёта по pitch
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

  // Custom: пиксели заданы напрямую
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
    const pixelsWide = Math.round(config.totalResolutionWidth / cabinetsWide)
    const pixelsHigh = Math.round(config.totalResolutionHeight / cabinetsHigh)
    return {
      pixelsWide,
      pixelsHigh,
      totalPixels: pixelsWide * pixelsHigh,
    }
  }

  const pixelsWide = Math.round(cabinetWidthMm / config.pixelPitchMm)
  const pixelsHigh = Math.round(cabinetHeightMm / config.pixelPitchMm)
  return {
    pixelsWide,
    pixelsHigh,
    totalPixels: pixelsWide * pixelsHigh,
  }
}

/**
 * Генерирует сетку кабинетов с метками A1, A2, B1…
 * Строки — буквы сверху вниз (row 0 = A = верх стены, max row = низ),
 * столбцы — числа слева направо. В SVG больший row — ниже по Y.
 */
export function generateCabinetGrid(config: ScreenConfig): Cabinet[] {
  const { pixelsWide, pixelsHigh, totalPixels } = calcPixelsPerCabinet(config)
  const cabinets: Cabinet[] = []

  for (let row = 0; row < config.cabinetsHigh; row++) {
    const rowLetter = rowIndexToLetter(row)
    for (let col = 0; col < config.cabinetsWide; col++) {
      const label = `${rowLetter}${col + 1}`
      cabinets.push({
        id: label,
        label,
        row,
        col,
        rowLetter,
        pixelsWide,
        pixelsHigh,
        totalPixels,
        maxPowerW: config.maxPowerPerCabinetW,
      })
    }
  }

  return cabinets
}

/** Проверяет, помечена ли ячейка как пустая */
export function isEmptyCabinet(label: string, emptyCabinets: Set<string>): boolean {
  return emptyCabinets.has(label)
}

/** Оставляет только активные (не пустые) кабинеты */
export function filterActiveCabinets(
  cabinets: Cabinet[],
  emptyCabinets: Set<string>,
): Cabinet[] {
  return cabinets.filter((c) => !emptyCabinets.has(c.label))
}

/** Маска активных ячеек сетки */
export function buildActiveCellMask(
  wide: number,
  high: number,
  emptyCabinets: Set<string>,
): boolean[][] {
  const mask: boolean[][] = []
  for (let row = 0; row < high; row++) {
    const rowLetter = rowIndexToLetter(row)
    const rowMask: boolean[] = []
    for (let col = 0; col < wide; col++) {
      const label = `${rowLetter}${col + 1}`
      rowMask.push(!emptyCabinets.has(label))
    }
    mask.push(rowMask)
  }
  return mask
}

/** Число активных ячеек в прямоугольном регионе */
export function activeCellsInRegion(
  mask: boolean[][],
  colStart: number,
  rowStart: number,
  width: number,
  height: number,
): number {
  let count = 0
  for (let r = rowStart; r < rowStart + height; r++) {
    for (let c = colStart; c < colStart + width; c++) {
      if (mask[r]?.[c]) count++
    }
  }
  return count
}

/** Находит кабинет по метке */
export function findCabinet(cabinets: Cabinet[], label: string): Cabinet | undefined {
  return cabinets.find((c) => c.label === label)
}

/**
 * Обход прямоугольного региона снизу вверх, в каждом ряду — одно горизонтальное направление.
 * direction=ltr: слева направо; direction=rtl: справа налево.
 */
export function orderRegionByDirection(
  cabinets: Cabinet[],
  colStart: number,
  rowStart: number,
  width: number,
  height: number,
  direction: LineDirection = 'ltr',
): Cabinet[] {
  const byPos = new Map<string, Cabinet>()
  for (const cab of cabinets) {
    byPos.set(`${cab.row},${cab.col}`, cab)
  }

  const ltr = direction === 'ltr'
  const ordered: Cabinet[] = []
  for (let ri = 0; ri < height; ri++) {
    const rowFromTop = height - 1 - ri
    const absRow = rowStart + rowFromTop
    if (ltr) {
      for (let c = 0; c < width; c++) {
        const cab = byPos.get(`${absRow},${colStart + c}`)
        if (cab) ordered.push(cab)
      }
    } else {
      for (let c = width - 1; c >= 0; c--) {
        const cab = byPos.get(`${absRow},${colStart + c}`)
        if (cab) ordered.push(cab)
      }
    }
  }
  return ordered
}

/**
 * Змейка (snake): снизу вверх, в каждом ряду направление чередуется L/R.
 * Первый (нижний) ряд — от chainStartEdge.
 */
export function orderRegionBySnake(
  cabinets: Cabinet[],
  colStart: number,
  rowStart: number,
  width: number,
  height: number,
  startEdge: ChainStartEdge = 'left',
): Cabinet[] {
  const byPos = new Map<string, Cabinet>()
  for (const cab of cabinets) {
    byPos.set(`${cab.row},${cab.col}`, cab)
  }

  const ordered: Cabinet[] = []
  for (let ri = 0; ri < height; ri++) {
    const rowFromTop = height - 1 - ri
    const absRow = rowStart + rowFromTop
    const ltr = ri % 2 === 0 ? startEdge === 'left' : startEdge === 'right'
    if (ltr) {
      for (let c = 0; c < width; c++) {
        const cab = byPos.get(`${absRow},${colStart + c}`)
        if (cab) ordered.push(cab)
      }
    } else {
      for (let c = width - 1; c >= 0; c--) {
        const cab = byPos.get(`${absRow},${colStart + c}`)
        if (cab) ordered.push(cab)
      }
    }
  }
  return ordered
}

/** Вертикальный обход снизу вверх по столбцам (только вверх) */
export function orderRegionVerticalUp(
  cabinets: Cabinet[],
  colStart: number,
  rowStart: number,
  width: number,
  height: number,
  direction: LineDirection = 'ltr',
): Cabinet[] {
  const byPos = new Map<string, Cabinet>()
  for (const cab of cabinets) {
    byPos.set(`${cab.row},${cab.col}`, cab)
  }

  const ordered: Cabinet[] = []
  const colOrder = direction === 'ltr'
    ? Array.from({ length: width }, (_, i) => i)
    : Array.from({ length: width }, (_, i) => width - 1 - i)

  for (const c of colOrder) {
    const absCol = colStart + c
    for (let ri = 0; ri < height; ri++) {
      const rowFromTop = height - 1 - ri
      const absRow = rowStart + rowFromTop
      const cab = byPos.get(`${absRow},${absCol}`)
      if (cab) ordered.push(cab)
    }
  }
  return ordered
}

/** Вертикальная змейка: столбцы чередуют направление вверх/вниз */
export function orderRegionVerticalSnake(
  cabinets: Cabinet[],
  colStart: number,
  rowStart: number,
  width: number,
  height: number,
  direction: LineDirection = 'ltr',
): Cabinet[] {
  const byPos = new Map<string, Cabinet>()
  for (const cab of cabinets) {
    byPos.set(`${cab.row},${cab.col}`, cab)
  }

  const ordered: Cabinet[] = []
  const colOrder = direction === 'ltr'
    ? Array.from({ length: width }, (_, i) => i)
    : Array.from({ length: width }, (_, i) => width - 1 - i)

  for (let ci = 0; ci < colOrder.length; ci++) {
    const absCol = colStart + colOrder[ci]
    const goUp = ci % 2 === 0
    if (goUp) {
      for (let ri = 0; ri < height; ri++) {
        const rowFromTop = height - 1 - ri
        const absRow = rowStart + rowFromTop
        const cab = byPos.get(`${absRow},${absCol}`)
        if (cab) ordered.push(cab)
      }
    } else {
      for (let ri = height - 1; ri >= 0; ri--) {
        const rowFromTop = height - 1 - ri
        const absRow = rowStart + rowFromTop
        const cab = byPos.get(`${absRow},${absCol}`)
        if (cab) ordered.push(cab)
      }
    }
  }
  return ordered
}

/** Считает число соседних пар в последовательности */
function countAdjacentPairs(order: Cabinet[]): number {
  let count = 0
  for (let i = 0; i < order.length - 1; i++) {
    if (areAdjacentCabinets(order[i], order[i + 1])) count++
  }
  return count
}

/** Суммарная длина power-линков по порядку (для выбора лучшего варианта 2.9) */
function totalPowerLinkLength(
  order: Cabinet[],
  cabinetWidthMm: number,
  cabinetHeightMm: number,
): number {
  let total = 0
  for (let i = 0; i < order.length - 1; i++) {
    if (areAdjacentCabinets(order[i], order[i + 1])) {
      total += powerLinkLengthBetween(order[i], order[i + 1], cabinetWidthMm, cabinetHeightMm)
    }
  }
  return total
}

/**
 * Гибкий вертикальный обход для 2.9: выбирает вариант с минимальной длиной линков.
 */
export function orderRegionVerticalFlexible(
  cabinets: Cabinet[],
  colStart: number,
  rowStart: number,
  width: number,
  height: number,
  direction: LineDirection = 'ltr',
  cabinetWidthMm = 500,
  cabinetHeightMm = 500,
): Cabinet[] {
  const candidates = [
    orderRegionVerticalUp(cabinets, colStart, rowStart, width, height, direction),
    orderRegionVerticalSnake(cabinets, colStart, rowStart, width, height, direction),
  ]

  return candidates.reduce((best, candidate) => {
    const bestAdj = countAdjacentPairs(best)
    const candAdj = countAdjacentPairs(candidate)
    if (candAdj !== bestAdj) return candAdj > bestAdj ? candidate : best
    const bestLen = totalPowerLinkLength(best, cabinetWidthMm, cabinetHeightMm)
    const candLen = totalPowerLinkLength(candidate, cabinetWidthMm, cabinetHeightMm)
    return candLen < bestLen ? candidate : best
  })
}

/**
 * Упорядочивание power-региона по пресету шага пикселя.
 */
export function orderPowerRegionByPreset(
  cabinets: Cabinet[],
  colStart: number,
  rowStart: number,
  width: number,
  height: number,
  preset: PitchPresetId,
  direction: LineDirection = 'ltr',
  cabinetWidthMm = 500,
  cabinetHeightMm = 500,
): Cabinet[] {
  switch (preset) {
    case '3.9-reshet':
      return orderRegionVerticalUp(cabinets, colStart, rowStart, width, height, direction)
    case '2.9':
      return orderRegionVerticalFlexible(
        cabinets,
        colStart,
        rowStart,
        width,
        height,
        direction,
        cabinetWidthMm,
        cabinetHeightMm,
      )
    case '3.9-big':
    case '3.9-small':
    default:
      return orderRegionByDirection(cabinets, colStart, rowStart, width, height, direction)
  }
}

/** Змейка внутри прямоугольного региона (алиас для data-маршрутизации) */
export function snakeOrderInRegion(
  cabinets: Cabinet[],
  colStart: number,
  rowStart: number,
  width: number,
  height: number,
  startEdge: ChainStartEdge = 'left',
): Cabinet[] {
  return orderRegionBySnake(cabinets, colStart, rowStart, width, height, startEdge)
}

/** Обход всей сетки змейкой снизу вверх */
export function snakeOrder(
  cabinets: Cabinet[],
  wide: number,
  high: number,
  startEdge: ChainStartEdge = 'left',
): Cabinet[] {
  return orderRegionBySnake(cabinets, 0, 0, wide, high, startEdge)
}

/** Нижний ряд группы (максимальный row) */
export function maxRowInGroup(cabinets: Cabinet[]): number {
  return Math.max(...cabinets.map((c) => c.row))
}

/** Кабинет старта по умолчанию — первая в змейке снизу вверх */
export function bottomStartCabinetForGroup(
  cabinets: Cabinet[],
  startEdge: ChainStartEdge = 'left',
): Cabinet | undefined {
  const ordered = orderGroupBySnake(cabinets, startEdge)
  return ordered[0]
}

/** Манхэттенское расстояние между кабинетами */
function manhattan(a: Cabinet, b: Cabinet): number {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col)
}

/** Соседи кабинета в группе (4-связность) */
function groupNeighbors(cab: Cabinet, byPos: Map<string, Cabinet>): Cabinet[] {
  const dirs = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ] as const
  const result: Cabinet[] = []
  for (const [dr, dc] of dirs) {
    const neighbor = byPos.get(`${cab.row + dr},${cab.col + dc}`)
    if (neighbor) result.push(neighbor)
  }
  return result
}

/** Предпочитает соседа, продолжающего змейку (горизонтально в ряду, затем вертикально) */
function sortNeighborsBySnake(
  neighbors: Cabinet[],
  current: Cabinet,
  startEdge: ChainStartEdge,
): Cabinet[] {
  const direction = edgeToDirection(startEdge)
  return [...neighbors].sort((a, b) => {
    const rowA = a.row === current.row
    const rowB = b.row === current.row
    if (rowA !== rowB) return rowA ? -1 : 1
    if (rowA) {
      const stepA = direction === 'ltr' ? a.col - current.col : current.col - a.col
      const stepB = direction === 'ltr' ? b.col - current.col : current.col - b.col
      if ((stepA > 0) !== (stepB > 0)) return stepA > 0 ? -1 : 1
      return direction === 'ltr' ? a.col - b.col : b.col - a.col
    }
    return current.row - a.row - (current.row - b.row)
  })
}

/**
 * Упорядочивает кабинеты группы data-цепочки змейкой, начиная с заданной точки старта.
 */
export function orderCabinetsFromStartSnake(
  cabinets: Cabinet[],
  startLabel?: string,
  startEdge: ChainStartEdge = 'left',
): Cabinet[] {
  if (cabinets.length === 0) return []
  if (!startLabel) return orderGroupBySnake(cabinets, startEdge)

  const startCab = cabinets.find((c) => c.label === startLabel)
  if (!startCab) return orderGroupBySnake(cabinets, startEdge)

  const byPos = new Map<string, Cabinet>()
  for (const cab of cabinets) {
    byPos.set(`${cab.row},${cab.col}`, cab)
  }

  const visited = new Set<string>()
  const ordered: Cabinet[] = [startCab]
  visited.add(startCab.label)

  while (ordered.length < cabinets.length) {
    const current = ordered[ordered.length - 1]
    const neighbors = groupNeighbors(current, byPos).filter(
      (c) => !visited.has(c.label),
    )

    if (neighbors.length > 0) {
      const next = sortNeighborsBySnake(neighbors, current, startEdge)[0]
      ordered.push(next)
      visited.add(next.label)
      continue
    }

    const unvisited = cabinets.filter((c) => !visited.has(c.label))
    const nearest = unvisited.reduce((best, c) =>
      manhattan(current, c) < manhattan(current, best) ? c : best,
    )
    ordered.push(nearest)
    visited.add(nearest.label)
  }

  return ordered
}

/**
 * Упорядочивает кабинеты группы power-линии по пресету.
 */
export function orderPowerCabinetsFromStart(
  cabinets: Cabinet[],
  preset: PitchPresetId,
  startLabel: string | undefined,
  startEdge: ChainStartEdge,
  cabinetWidthMm: number,
  cabinetHeightMm: number,
): Cabinet[] {
  if (cabinets.length === 0) return []
  if (!startLabel) {
    const minRow = Math.min(...cabinets.map((c) => c.row))
    const maxRow = Math.max(...cabinets.map((c) => c.row))
    const minCol = Math.min(...cabinets.map((c) => c.col))
    const maxCol = Math.max(...cabinets.map((c) => c.col))
    return orderPowerRegionByPreset(
      cabinets,
      minCol,
      minRow,
      maxCol - minCol + 1,
      maxRow - minRow + 1,
      preset,
      edgeToDirection(startEdge),
      cabinetWidthMm,
      cabinetHeightMm,
    )
  }
  return orderCabinetsFromStart(cabinets, startLabel, startEdge)
}

/** Предпочитает соседа, продолжающего горизонтальный обход в заданном направлении */
function sortNeighborsByDirection(
  neighbors: Cabinet[],
  current: Cabinet,
  direction: LineDirection,
): Cabinet[] {
  const ltr = direction === 'ltr'
  return [...neighbors].sort((a, b) => {
    const rowA = a.row === current.row
    const rowB = b.row === current.row
    if (rowA !== rowB) return rowA ? -1 : 1
    if (rowA) {
      const stepA = ltr ? a.col - current.col : current.col - a.col
      const stepB = ltr ? b.col - current.col : current.col - b.col
      if ((stepA > 0) !== (stepB > 0)) return stepA > 0 ? -1 : 1
      return ltr ? a.col - b.col : b.col - a.col
    }
    return current.row - a.row - (current.row - b.row) || (ltr ? a.col - b.col : b.col - a.col)
  })
}

/**
 * Упорядочивает кабинеты группы, начиная с заданной точки старта.
 * Без старта — единое направление снизу вверх; с кастомным стартом — обход по соседям с учётом направления.
 */
export function orderCabinetsFromStart(
  cabinets: Cabinet[],
  startLabel?: string,
  startEdge: ChainStartEdge = 'left',
): Cabinet[] {
  if (cabinets.length === 0) return []
  const direction = edgeToDirection(startEdge)
  if (!startLabel) return orderGroupByDirection(cabinets, startEdge)

  const startCab = cabinets.find((c) => c.label === startLabel)
  if (!startCab) return orderGroupByDirection(cabinets, startEdge)

  const byPos = new Map<string, Cabinet>()
  for (const cab of cabinets) {
    byPos.set(`${cab.row},${cab.col}`, cab)
  }

  const visited = new Set<string>()
  const ordered: Cabinet[] = [startCab]
  visited.add(startCab.label)

  while (ordered.length < cabinets.length) {
    const current = ordered[ordered.length - 1]
    const neighbors = groupNeighbors(current, byPos).filter(
      (c) => !visited.has(c.label),
    )

    if (neighbors.length > 0) {
      const next = sortNeighborsByDirection(neighbors, current, direction)[0]
      ordered.push(next)
      visited.add(next.label)
      continue
    }

    const unvisited = cabinets.filter((c) => !visited.has(c.label))
    const nearest = unvisited.reduce((best, c) =>
      manhattan(current, c) < manhattan(current, best) ? c : best,
    )
    ordered.push(nearest)
    visited.add(nearest.label)
  }

  return ordered
}

/** Обход группы снизу вверх с единым горизонтальным направлением */
export function orderGroupByDirection(
  cabinets: Cabinet[],
  startEdge: ChainStartEdge = 'left',
): Cabinet[] {
  if (cabinets.length === 0) return []
  const minRow = Math.min(...cabinets.map((c) => c.row))
  const maxRow = Math.max(...cabinets.map((c) => c.row))
  const minCol = Math.min(...cabinets.map((c) => c.col))
  const maxCol = Math.max(...cabinets.map((c) => c.col))
  return orderRegionByDirection(
    cabinets,
    minCol,
    minRow,
    maxCol - minCol + 1,
    maxRow - minRow + 1,
    edgeToDirection(startEdge),
  )
}

/** Обход группы змейкой снизу вверх */
export function orderGroupBySnake(
  cabinets: Cabinet[],
  startEdge: ChainStartEdge = 'left',
): Cabinet[] {
  if (cabinets.length === 0) return []
  const minRow = Math.min(...cabinets.map((c) => c.row))
  const maxRow = Math.max(...cabinets.map((c) => c.row))
  const minCol = Math.min(...cabinets.map((c) => c.col))
  const maxCol = Math.max(...cabinets.map((c) => c.col))
  return orderRegionBySnake(
    cabinets,
    minCol,
    minRow,
    maxCol - minCol + 1,
    maxRow - minRow + 1,
    startEdge,
  )
}

/** @deprecated Используйте orderGroupBySnake для data */
export function snakeOrderForGroup(
  cabinets: Cabinet[],
  startEdge: ChainStartEdge = 'left',
): Cabinet[] {
  return orderGroupBySnake(cabinets, startEdge)
}

/** Соседние кабинеты по 4-связности на сетке */
export function areAdjacentCabinets(a: Cabinet, b: Cabinet): boolean {
  const dr = Math.abs(a.row - b.row)
  const dc = Math.abs(a.col - b.col)
  return (dr === 1 && dc === 0) || (dr === 0 && dc === 1)
}

/** Длина линка между двумя соседними кабинетами (фиксированные значения для data-backup) */
export function linkLengthBetween(a: Cabinet, b: Cabinet): number {
  if (a.row === b.row) return 0.7
  if (a.col === b.col) return 1.2
  return 1.0
}

/**
 * Длина power-линка по геометрии кабинета:
 * горизонталь = ширина мм, вертикаль = высота мм.
 */
export function powerLinkLengthBetween(
  a: Cabinet,
  b: Cabinet,
  cabinetWidthMm: number,
  cabinetHeightMm: number,
): number {
  if (a.row === b.row) return cabinetWidthMm / 1000
  if (a.col === b.col) return cabinetHeightMm / 1000
  const dx = Math.abs(a.col - b.col) * cabinetWidthMm
  const dy = Math.abs(a.row - b.row) * cabinetHeightMm
  return Math.sqrt(dx * dx + dy * dy) / 1000
}

/** Направление связи */
export function linkDirection(a: Cabinet, b: Cabinet): 'horizontal' | 'vertical' {
  return a.row === b.row ? 'horizontal' : 'vertical'
}
