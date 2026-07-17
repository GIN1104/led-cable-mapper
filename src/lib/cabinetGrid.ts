import type { Cabinet, ChainStartEdge, LineDirection, PitchPresetId, ScreenConfig } from '../types'
import { getPitchPreset } from './pitchPresets'

/** left = LTR (слева направо), right = RTL (справа налево) */
export function edgeToDirection(edge: ChainStartEdge): LineDirection {
  return edge === 'left' ? 'ltr' : 'rtl'
}

export function directionToEdge(direction: LineDirection): ChainStartEdge {
  return direction === 'ltr' ? 'left' : 'right'
}

/** Минимальный размер стены по ширине/высоте (м) */
export const MIN_WALL_DIMENSION_M = 0.5

/** Ограничивает размер стены снизу */
export function clampWallDimensionM(value: number): number {
  return Math.max(MIN_WALL_DIMENSION_M, value)
}

/** Допустимый ввод при наборе (пустая строка, цифры, одна десятичная точка) */
export function isMeterDraftEditable(raw: string): boolean {
  return raw === '' || /^\d*[.,]?\d*$/.test(raw)
}

/** Парсит черновик для commit/blur; null — неполный или пустой ввод */
export function parseMeterDraftForCommit(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === '.' || trimmed === ',') return null
  const normalized = trimmed.replace(',', '.')
  if (normalized.endsWith('.')) return null
  const val = parseFloat(normalized)
  return Number.isNaN(val) ? null : val
}

/** Значение для превью сетки во время набора */
export function previewMeterFromDraft(raw: string, committed: number): number {
  const forCommit = parseMeterDraftForCommit(raw)
  if (forCommit !== null) return clampWallDimensionM(forCommit)
  const trimmed = raw.trim().replace(',', '.')
  if (trimmed === '' || trimmed === '.') return committed
  const loose = parseFloat(trimmed)
  if (!Number.isNaN(loose)) return clampWallDimensionM(loose)
  return committed
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

/** Равномерно делит cabinetsWide на count вертикальных полос (минимум 1 колонка) */
export function equalStripWidths(count: number, cabinetsWide: number): number[] {
  const total = Math.max(1, cabinetsWide)
  const n = Math.max(1, Math.min(Math.floor(count) || 1, total))
  const base = Math.floor(total / n)
  const rem = total % n
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0))
}

/**
 * Нормализует ширины полос: ≥1 колонка каждая, сумма === cabinetsWide.
 * При смене ширины стены сохраняет пропорции.
 */
export function normalizeStripWidths(
  widths: number[] | undefined,
  cabinetsWide: number,
): number[] {
  const total = Math.max(1, cabinetsWide)
  if (!widths || widths.length === 0) return [total]

  const count = Math.max(1, Math.min(widths.length, total))
  const parts = widths.slice(0, count).map((w) => Math.max(1, Math.round(Number(w)) || 1))
  const sum = parts.reduce((a, b) => a + b, 0)
  if (sum === total) return parts

  const scaled = parts.map((w) => Math.max(1, Math.round((w / sum) * total)))
  let scaledSum = scaled.reduce((a, b) => a + b, 0)
  let diff = total - scaledSum
  let i = scaled.length - 1
  let guard = 0
  while (diff !== 0 && guard < total * 4) {
    guard++
    if (diff > 0) {
      scaled[i]! += 1
      diff -= 1
    } else if (scaled[i]! > 1) {
      scaled[i]! -= 1
      diff += 1
    }
    i = (i - 1 + scaled.length) % scaled.length
  }
  return scaled
}

/** Меняет ширину одной полосы; избыток/недостаток берёт соседняя (обычно последняя) */
export function setStripWidthAt(
  widths: number[],
  index: number,
  newWidth: number,
  cabinetsWide: number,
): number[] {
  const normalized = normalizeStripWidths(widths, cabinetsWide)
  if (normalized.length === 1) return [cabinetsWide]
  if (index < 0 || index >= normalized.length) return normalized

  const othersMin = normalized.length - 1
  const clamped = Math.max(1, Math.min(Math.floor(newWidth) || 1, cabinetsWide - othersMin))
  const absorbIdx = index === normalized.length - 1 ? normalized.length - 2 : normalized.length - 1
  const next = [...normalized]
  const delta = clamped - next[index]!
  next[index] = clamped
  next[absorbIdx]! -= delta

  if (next[absorbIdx]! < 1) {
    return normalizeStripWidths(
      next.map((w) => Math.max(1, w)),
      cabinetsWide,
    )
  }
  return next
}

/** Сколько визуальных зазоров между полосами стоит слева от колонки col */
export function stripGapsBeforeCol(col: number, stripWidths: number[]): number {
  if (stripWidths.length <= 1 || col <= 0) return 0
  let acc = 0
  let gaps = 0
  for (let i = 0; i < stripWidths.length - 1; i++) {
    acc += stripWidths[i]!
    if (col >= acc) gaps++
    else break
  }
  return gaps
}

/** Диапазоны колонок каждой полосы: [startCol, endCol) */
export function stripColumnRanges(
  stripWidths: number[],
): Array<{ index: number; startCol: number; endCol: number; width: number }> {
  const ranges: Array<{
    index: number
    startCol: number
    endCol: number
    width: number
  }> = []
  let start = 0
  for (let i = 0; i < stripWidths.length; i++) {
    const width = Math.max(1, stripWidths[i]!)
    ranges.push({ index: i, startCol: start, endCol: start + width, width })
    start += width
  }
  return ranges
}

/** Индекс полосы для колонки (0-based); при одной полосе — всегда 0 */
export function stripIndexForCol(col: number, stripWidths: number[]): number {
  if (stripWidths.length <= 1) return 0
  for (const { index, startCol, endCol } of stripColumnRanges(stripWidths)) {
    if (col >= startCol && col < endCol) return index
  }
  return Math.max(0, stripWidths.length - 1)
}

/** Тикшорет не переходит между полосами: одна полоса или одна и та же колонка-группа */
export function sameStripCol(
  colA: number,
  colB: number,
  stripWidths: number[],
): boolean {
  if (stripWidths.length <= 1) return true
  return stripIndexForCol(colA, stripWidths) === stripIndexForCol(colB, stripWidths)
}

/**
 * Назначение стрипов на VX1000: края → 1, центр → 2.
 * Пример: 3 полосы → [1, 2, 1]; 2 полосы → [1, 2].
 */
export function defaultStripControllerIds(stripCount: number): number[] {
  const n = Math.max(1, Math.floor(stripCount) || 1)
  if (n === 1) return [1]
  if (n === 2) return [1, 2]
  return Array.from({ length: n }, (_, i) => (i === 0 || i === n - 1 ? 1 : 2))
}

/** Нормализует stripControllerIds под число полос (1|2). */
export function normalizeStripControllerIds(
  ids: number[] | undefined,
  stripCount: number,
): number[] {
  const n = Math.max(1, stripCount)
  const fallback = defaultStripControllerIds(n)
  if (!ids || ids.length === 0) return fallback
  return Array.from({ length: n }, (_, i) => {
    const v = ids[i] ?? fallback[i] ?? 1
    return v === 2 ? 2 : 1
  })
}

/** Пересчитывает cabinetsWide/High из wallWidthM/wallHeightM и размеров кабинета */
export function syncCabinetGridFromMeters(config: ScreenConfig): ScreenConfig {
  const { cabinetsWide, cabinetsHigh } = calcCabinetsFromMeters(
    config.wallWidthM,
    config.wallHeightM,
    config.cabinetWidthMm,
    config.cabinetHeightMm,
  )
  const stripWidths = normalizeStripWidths(config.stripWidths, cabinetsWide)
  // dualVx1000 сохраняем при смене числа стрипов; ids нормализуем под stripWidths
  const dualVx1000 = config.dualVx1000 ?? false
  const stripControllerIds = normalizeStripControllerIds(
    config.stripControllerIds,
    stripWidths.length,
  )
  const stripsSame =
    stripWidths.length === (config.stripWidths?.length ?? 0) &&
    stripWidths.every((w, i) => w === config.stripWidths?.[i])
  const idsSame =
    stripControllerIds.length === (config.stripControllerIds?.length ?? 0) &&
    stripControllerIds.every((id, i) => id === config.stripControllerIds?.[i])
  const dualSame = dualVx1000 === (config.dualVx1000 ?? false)

  if (
    cabinetsWide === config.cabinetsWide &&
    cabinetsHigh === config.cabinetsHigh &&
    stripsSame &&
    idsSame &&
    dualSame &&
    config.dualVx1000 !== undefined &&
    config.stripControllerIds !== undefined
  ) {
    return config
  }
  return {
    ...config,
    cabinetsWide,
    cabinetsHigh,
    stripWidths,
    dualVx1000,
    stripControllerIds,
  }
}

/** Преобразует индекс буквы в букву (0 → A, 1 → B, …) */
export function rowIndexToLetter(index: number): string {
  let n = index
  let result = ''
  do {
    result = String.fromCharCode(65 + (n % 26)) + result
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return result
}

/** Буква ряда кабинета: row 0 = верх стены, max row = низ; A = нижний ряд */
export function cabinetRowLetter(row: number, totalRows: number): string {
  return rowIndexToLetter(totalRows - 1 - row)
}

/** Метка кабинета по позиции в сетке (A1 = нижний левый при chainStartEdge=left) */
export function cabinetLabel(row: number, col: number, totalRows: number): string {
  return `${cabinetRowLetter(row, totalRows)}${col + 1}`
}

/** Индекс строки из буквы метки (A → нижний ряд) */
export function letterToRowIndex(letters: string, totalRows: number): number {
  let letterIndex = 0
  for (const ch of letters) {
    letterIndex = letterIndex * 26 + (ch.charCodeAt(0) - 64)
  }
  return totalRows - 1 - (letterIndex - 1)
}

/** Старт цепочки/линии: нижний ряд, край по chainStartEdge */
export function inferChainStart(
  cabinets: Cabinet[],
  startEdge: ChainStartEdge = 'left',
): string | undefined {
  if (cabinets.length === 0) return undefined
  const direction = edgeToDirection(startEdge)
  const maxRow = Math.max(...cabinets.map((c) => c.row))
  const bottom = cabinets.filter((c) => c.row === maxRow)
  const start = [...bottom].sort((a, b) =>
    direction === 'ltr' ? a.col - b.col : b.col - a.col,
  )[0]
  return start?.label
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
 * row 0 = верх стены, max row = низ; A = нижний ряд, далее B, C вверх.
 * Столбцы — числа слева направо. В SVG больший row — ниже по Y.
 */
export function generateCabinetGrid(config: ScreenConfig): Cabinet[] {
  const { pixelsWide, pixelsHigh, totalPixels } = calcPixelsPerCabinet(config)
  const cabinets: Cabinet[] = []

  for (let row = 0; row < config.cabinetsHigh; row++) {
    const rowLetter = cabinetRowLetter(row, config.cabinetsHigh)
    for (let col = 0; col < config.cabinetsWide; col++) {
      const label = cabinetLabel(row, col, config.cabinetsHigh)
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
    const rowMask: boolean[] = []
    for (let col = 0; col < wide; col++) {
      const label = cabinetLabel(row, col, high)
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
