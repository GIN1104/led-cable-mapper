import type {
  Cabinet,
  GridLink,
  LineDirection,
  PitchPresetId,
  PowerLine,
  RoutingValidationWarning,
  ScreenConfig,
} from '../types'
import {
  getMaxCabinetsPerPowerLine,
  getPreferredCabinetsPerPowerLine,
  MAX_POWER_LINK_LENGTH_M,
  MAX_POWER_PER_LINE_W,
} from './constants'
import {
  areAdjacentCabinets,
  edgeToDirection,
  inferChainStart,
  linkDirection,
  orderPowerCabinetsFromStart,
  powerLinkLengthBetween,
} from './cabinetGrid'
import type { CellActiveFn } from './rectangularPartition'

/** Проверяет, допустим ли power-линк между двумя кабинетами */
export function isValidPowerLink(
  a: Cabinet,
  b: Cabinet,
  cabinetWidthMm: number,
  cabinetHeightMm: number,
): boolean {
  if (!areAdjacentCabinets(a, b)) return false
  return (
    powerLinkLengthBetween(a, b, cabinetWidthMm, cabinetHeightMm) <=
    MAX_POWER_LINK_LENGTH_M
  )
}

/** Соседи кабинета в графе power-связности (4-связность, линк ≤ 1.5 м) */
export function getPowerNeighbors(
  cab: Cabinet,
  pool: Cabinet[],
  config: ScreenConfig,
): Cabinet[] {
  const { cabinetWidthMm, cabinetHeightMm } = config
  return pool.filter(
    (other) =>
      other.label !== cab.label &&
      isValidPowerLink(cab, other, cabinetWidthMm, cabinetHeightMm),
  )
}

/** Компоненты связности по power-графу */
function findPowerComponents(
  cabinets: Cabinet[],
  config: ScreenConfig,
): Cabinet[][] {
  const visited = new Set<string>()
  const components: Cabinet[][] = []

  for (const start of cabinets) {
    if (visited.has(start.label)) continue
    const component: Cabinet[] = []
    const queue: Cabinet[] = [start]
    visited.add(start.label)

    while (queue.length > 0) {
      const cab = queue.shift()!
      component.push(cab)
      for (const neighbor of getPowerNeighbors(cab, cabinets, config)) {
        if (!visited.has(neighbor.label)) {
          visited.add(neighbor.label)
          queue.push(neighbor)
        }
      }
    }
    components.push(component)
  }

  return components
}

/** Предпочитает соседа при росте power-цепочки по пресету */
function sortNeighborsForPowerGrowth(
  neighbors: Cabinet[],
  current: Cabinet,
  preset: PitchPresetId,
  direction: LineDirection,
): Cabinet[] {
  const ltr = direction === 'ltr'
  return [...neighbors].sort((a, b) => {
    switch (preset) {
      case '3.9-reshet': {
        const upA = a.row < current.row
        const upB = b.row < current.row
        if (upA !== upB) return upA ? -1 : 1
        if (upA) return ltr ? a.col - b.col : b.col - a.col
        return ltr ? a.col - b.col : b.col - a.col
      }
      case '2.9': {
        const vertA = a.col === current.col
        const vertB = b.col === current.col
        if (vertA !== vertB) return vertA ? -1 : 1
        if (vertA) return a.row - b.row
        return ltr ? a.col - b.col : b.col - a.col
      }
      case '3.9-big':
      case '3.9-small':
      default: {
        const horizA = a.row === current.row
        const horizB = b.row === current.row
        if (horizA !== horizB) return horizA ? -1 : 1
        if (horizA) {
          const stepA = ltr ? a.col - current.col : current.col - a.col
          const stepB = ltr ? b.col - current.col : current.col - b.col
          if ((stepA > 0) !== (stepB > 0)) return stepA > 0 ? -1 : 1
          return ltr ? a.col - b.col : b.col - a.col
        }
        return current.row - a.row - (current.row - b.row)
      }
    }
  })
}

/** Выбирает стартовую точку: нижний ряд, край по chainStartEdge */
function selectPathStart(
  remaining: Cabinet[],
  config: ScreenConfig,
): Cabinet {
  const direction = edgeToDirection(config.chainStartEdge)
  return [...remaining].sort((a, b) => {
    if (b.row !== a.row) return b.row - a.row
    return direction === 'ltr' ? a.col - b.col : b.col - a.col
  })[0]
}

/** Растит связную цепочку из remaining до maxSize */
function growPowerPath(
  remaining: Cabinet[],
  start: Cabinet,
  config: ScreenConfig,
  maxSize: number,
): Cabinet[] {
  const direction = edgeToDirection(config.chainStartEdge)
  const path: Cabinet[] = [start]
  const inPath = new Set<string>([start.label])
  let current = start

  while (path.length < maxSize) {
    const candidates = getPowerNeighbors(current, remaining, config).filter(
      (n) => !inPath.has(n.label),
    )
    if (candidates.length === 0) break

    const next = sortNeighborsForPowerGrowth(
      candidates,
      current,
      config.pitchPreset,
      direction,
    )[0]
    path.push(next)
    inPath.add(next.label)
    current = next
  }

  return path
}

/**
 * Разбивает компоненту связности на минимальное число power-линий.
 * Старт всегда с нижнего края по chainStartEdge (не из середины ряда).
 * Цель заполнения: preferred при чистом плане ≤6 линий, иначе max.
 */
function partitionComponent(
  component: Cabinet[],
  config: ScreenConfig,
): Cabinet[][] {
  if (component.length === 0) return []

  const preferred = getPreferredCabinetsPerPowerLine(config)
  const maxSize = getMaxCabinetsPerPowerLine(config)
  const minCol = Math.min(...component.map((c) => c.col))
  const maxCol = Math.max(...component.map((c) => c.col))
  const minRow = Math.min(...component.map((c) => c.row))
  const maxRow = Math.max(...component.map((c) => c.row))
  const packTarget = choosePowerPackWidth(
    maxCol - minCol + 1,
    maxRow - minRow + 1,
    preferred,
    maxSize,
  )
  const remaining = new Map(component.map((c) => [c.label, c]))
  const paths: Cabinet[][] = []

  while (remaining.size > 0) {
    const pool = [...remaining.values()]
    const start = selectPathStart(pool, config)
    const target =
      remaining.size >= packTarget
        ? Math.min(packTarget, maxSize)
        : Math.min(remaining.size, maxSize)
    const path = growPowerPath(pool, start, config, target)
    paths.push(path)
    for (const cab of path) {
      remaining.delete(cab.label)
    }
  }

  return paths
}

function buildLinksForLine(
  cabinets: Cabinet[],
  lineNumber: number,
  config: ScreenConfig,
): GridLink[] {
  const links: GridLink[] = []
  for (let i = 0; i < cabinets.length - 1; i++) {
    const from = cabinets[i]
    const to = cabinets[i + 1]
    if (
      !isValidPowerLink(
        from,
        to,
        config.cabinetWidthMm,
        config.cabinetHeightMm,
      )
    ) {
      continue
    }

    links.push({
      from,
      to,
      type: 'power',
      chainId: lineNumber,
      direction: linkDirection(from, to),
    })
  }
  return links
}

/** Старт линии по умолчанию: нижний ряд, край по chainStartEdge */
export function inferPowerLineStart(
  cabinets: Cabinet[],
  startEdge: ScreenConfig['chainStartEdge'],
): string | undefined {
  return inferChainStart(cabinets, startEdge)
}

function buildLinesFromGroups(
  lineGroups: Map<number, Cabinet[]>,
  config: ScreenConfig,
  startPoints: Record<number, string> = {},
  preserveOrder = false,
): { lines: PowerLine[]; links: GridLink[] } {
  const lines: PowerLine[] = []
  const links: GridLink[] = []
  const lineNumbers = [...lineGroups.keys()].sort((a, b) => a - b)

  for (const lineNumber of lineNumbers) {
    const raw = lineGroups.get(lineNumber) ?? []
    const startLabel =
      startPoints[lineNumber] && raw.some((c) => c.label === startPoints[lineNumber])
        ? startPoints[lineNumber]
        : inferPowerLineStart(raw, config.chainStartEdge)
    const ordered = preserveOrder
      ? raw
      : orderPowerCabinetsFromStart(
          raw,
          config.pitchPreset,
          startLabel,
          config.chainStartEdge,
          config.cabinetWidthMm,
          config.cabinetHeightMm,
        )
    if (ordered.length === 0) continue

    lines.push({
      lineNumber,
      cabinets: ordered,
      totalPowerW: ordered.reduce((sum, c) => sum + c.maxPowerW, 0),
    })
    links.push(...buildLinksForLine(ordered, lineNumber, config))
  }

  return { lines, links }
}

/** Проверяет, что кабинеты линии образуют одну связную power-компоненту */
function isLinePowerConnected(
  lineCabinets: Cabinet[],
  config: ScreenConfig,
): boolean {
  if (lineCabinets.length <= 1) return true

  const lineSet = new Set(lineCabinets.map((c) => c.label))
  const visited = new Set<string>()
  const queue: Cabinet[] = [lineCabinets[0]]
  visited.add(lineCabinets[0].label)

  while (queue.length > 0) {
    const cab = queue.shift()!
    for (const neighbor of getPowerNeighbors(cab, lineCabinets, config)) {
      if (!lineSet.has(neighbor.label) || visited.has(neighbor.label)) continue
      visited.add(neighbor.label)
      queue.push(neighbor)
    }
  }

  return visited.size === lineCabinets.length
}

/** Проверяет лимиты линий питания, связность и длину линков */
export function validatePowerLines(
  lines: PowerLine[],
  config: ScreenConfig,
): RoutingValidationWarning[] {
  const warnings: RoutingValidationWarning[] = []
  const maxCabinets = getMaxCabinetsPerPowerLine(config)

  for (const line of lines) {
    if (line.cabinets.length > maxCabinets) {
      warnings.push({
        type: 'power',
        id: line.lineNumber,
        message: `P${line.lineNumber}: ${line.cabinets.length} cabinets (max ${maxCabinets})`,
      })
    }
    if (line.totalPowerW > MAX_POWER_PER_LINE_W) {
      warnings.push({
        type: 'power',
        id: line.lineNumber,
        message: `P${line.lineNumber}: ${line.totalPowerW}W (max ${MAX_POWER_PER_LINE_W}W)`,
      })
    }

    if (!isLinePowerConnected(line.cabinets, config)) {
      warnings.push({
        type: 'power',
        id: line.lineNumber,
        message: `P${line.lineNumber}: disconnected cabinets on same line (no physical link path)`,
      })
    }

    for (let i = 0; i < line.cabinets.length - 1; i++) {
      const from = line.cabinets[i]
      const to = line.cabinets[i + 1]
      const len = powerLinkLengthBetween(
        from,
        to,
        config.cabinetWidthMm,
        config.cabinetHeightMm,
      )
      if (!areAdjacentCabinets(from, to)) {
        warnings.push({
          type: 'power',
          id: line.lineNumber,
          message: `P${line.lineNumber}: ${from.label}→${to.label} not adjacent`,
        })
      } else if (len > MAX_POWER_LINK_LENGTH_M) {
        warnings.push({
          type: 'power',
          id: line.lineNumber,
          message: `P${line.lineNumber}: ${from.label}→${to.label} link ${len.toFixed(2)}m (max ${MAX_POWER_LINK_LENGTH_M}m)`,
        })
      }
    }
  }
  return warnings
}

/** Горизонтальные полосы (3.9 big/small) vs вертикальный жадный обход */
function useHorizontalStripAlgorithm(config: ScreenConfig): boolean {
  switch (config.pitchPreset) {
    case '3.9-big':
    case '3.9-small':
      return true
    case '3.9-reshet':
    case '2.9':
      return false
    case 'custom':
      return getMaxCabinetsPerPowerLine(config) <= 24
    default:
      return true
  }
}

function findCabAt(
  pool: Map<string, Cabinet>,
  row: number,
  col: number,
): Cabinet | undefined {
  for (const cab of pool.values()) {
    if (cab.row === row && cab.col === col) return cab
  }
  return undefined
}

/**
 * Фаза 2: P-образная цепочка (вверх → горизонталь → вниз) для остатка у восточного края.
 */
function growPShapeChain(
  start: Cabinet,
  pool: Map<string, Cabinet>,
  config: ScreenConfig,
  maxSize: number,
): Cabinet[] {
  const direction = edgeToDirection(config.chainStartEdge)
  const ltr = direction === 'ltr'
  const path: Cabinet[] = [start]
  const inPath = new Set<string>([start.label])
  let current = start

  const tryStep = (row: number, col: number): boolean => {
    const next = findCabAt(pool, row, col)
    if (!next || inPath.has(next.label)) return false
    if (
      !isValidPowerLink(
        current,
        next,
        config.cabinetWidthMm,
        config.cabinetHeightMm,
      )
    ) {
      return false
    }
    path.push(next)
    inPath.add(next.label)
    current = next
    return true
  }

  // Вверх по столбцу
  while (path.length < maxSize) {
    if (!tryStep(current.row - 1, current.col)) break
  }

  // Горизонталь — один шаг (вторая нога P)
  if (path.length < maxSize) {
    const nextCol = ltr ? current.col + 1 : current.col - 1
    tryStep(current.row, nextCol)
  }

  // Вниз по столбцу
  while (path.length < maxSize) {
    if (!tryStep(current.row + 1, current.col)) break
  }

  return path
}

/** Стартовые точки P-цепочек: нижний ряд, каждый второй столбец остатка */
function pickPChainStarts(
  pool: Cabinet[],
  direction: LineDirection,
): Cabinet[] {
  if (pool.length === 0) return []
  const ltr = direction === 'ltr'
  const maxRow = Math.max(...pool.map((c) => c.row))
  const bottom = pool.filter((c) => c.row === maxRow)
  const cols = [...new Set(bottom.map((c) => c.col))].sort((a, b) =>
    ltr ? a - b : b - a,
  )

  const starts: Cabinet[] = []
  for (let i = 0; i < cols.length; i += 2) {
    const cab = bottom.find((c) => c.col === cols[i])
    if (cab) starts.push(cab)
  }
  return starts
}

type ColBand = { colStart: number; colEnd: number }

/** Бюджет линий: preferred (10/20) допустим только если план даёт ≤ этого числа полных линий */
const MAX_PREFERRED_POWER_LINES = 6

/**
 * Выбор ширины полосы / цели заполнения: preferred при чистом делении
 * на полные горизонтальные линии и lineCount ≤ 6; иначе max (плотнее упаковка).
 */
export function choosePowerPackWidth(
  colsWide: number,
  rowsHigh: number,
  preferred: number,
  maxSize: number,
): number {
  const pref = Math.min(preferred, maxSize)
  const max = Math.max(1, maxSize)
  if (colsWide <= 0 || rowsHigh <= 0) return pref

  // Чистый план preferred: полосы ширины preferred на всю высоту — полные горизонтали
  if (colsWide % pref === 0) {
    const lineCount = (colsWide / pref) * rowsHigh
    if (lineCount <= MAX_PREFERRED_POWER_LINES) return pref
  }

  return max
}

/**
 * Делит ширину стены на вертикальные полосы шириной до packWidth.
 * LTR: полные полосы слева, узкий остаток справа.
 * RTL: полные полосы справа, узкий остаток слева (порядок обхода — от края направления).
 */
function getColumnBands(
  minCol: number,
  maxCol: number,
  packWidth: number,
  direction: LineDirection,
): ColBand[] {
  const bands: ColBand[] = []
  if (direction === 'ltr') {
    for (let colStart = minCol; colStart <= maxCol; colStart += packWidth) {
      bands.push({
        colStart,
        colEnd: Math.min(colStart + packWidth - 1, maxCol),
      })
    }
    return bands
  }

  for (let colEnd = maxCol; colEnd >= minCol; colEnd -= packWidth) {
    const colStart = Math.max(minCol, colEnd - packWidth + 1)
    bands.push({ colStart, colEnd })
    if (colStart <= minCol) break
  }
  return bands
}

/** Горизонтальные полосы снизу вверх; fillTarget — целевой размер линии (≤ max) */
function partitionBandHorizontalStrips(
  bandCabs: Cabinet[],
  config: ScreenConfig,
  fillTarget: number,
): Cabinet[][] {
  const maxSize = getMaxCabinetsPerPowerLine(config)
  const target = Math.max(1, Math.min(fillTarget, maxSize))
  const direction = edgeToDirection(config.chainStartEdge)
  const ltr = direction === 'ltr'

  const minRow = Math.min(...bandCabs.map((c) => c.row))
  const maxRow = Math.max(...bandCabs.map((c) => c.row))
  const pool = new Map(bandCabs.map((c) => [c.label, c]))
  const paths: Cabinet[][] = []

  for (let row = maxRow; row >= minRow; row--) {
    const rowCabs = [...pool.values()]
      .filter((c) => c.row === row)
      .sort((a, b) => (ltr ? a.col - b.col : b.col - a.col))

    if (rowCabs.length === 0) continue

    // От края направления: LTR — слева, RTL — справа; набиваем до fillTarget
    const strip = rowCabs.slice(0, Math.min(target, rowCabs.length))
    paths.push(strip)
    for (const cab of strip) {
      pool.delete(cab.label)
    }
  }

  // Остаток ряда (редко) — отдельные отрезки от того же края, не превышая max
  while (pool.size > 0) {
    const remaining = [...pool.values()]
    const start = selectPathStart(remaining, config)
    const path = growPowerPath(remaining, start, config, maxSize)
    if (path.length === 0) break
    paths.push(path)
    for (const cab of path) {
      pool.delete(cab.label)
    }
  }

  return paths
}

/** P-образные цепочки для узкой остаточной полосы */
function partitionBandPShape(
  bandCabs: Cabinet[],
  config: ScreenConfig,
): Cabinet[][] {
  const maxSize = getMaxCabinetsPerPowerLine(config)
  const direction = edgeToDirection(config.chainStartEdge)
  const pool = new Map(bandCabs.map((c) => [c.label, c]))
  const paths: Cabinet[][] = []

  while (pool.size > 0) {
    const remaining = [...pool.values()]
    const starts = pickPChainStarts(remaining, direction)
    let grew = false

    for (const start of starts) {
      if (!pool.has(start.label)) continue
      const path = growPShapeChain(start, pool, config, maxSize)
      if (path.length === 0) continue
      paths.push(path)
      for (const cab of path) {
        pool.delete(cab.label)
      }
      grew = true
    }

    if (!grew) {
      const fallbackStart = selectPathStart(remaining, config)
      const path = growPShapeChain(fallbackStart, pool, config, maxSize)
      if (path.length === 0) {
        const single = pool.get(fallbackStart.label)
        if (single) {
          paths.push([single])
          pool.delete(single.label)
        } else {
          break
        }
      } else {
        paths.push(path)
        for (const cab of path) {
          pool.delete(cab.label)
        }
      }
    }
  }

  return paths
}

/** Оценка плана остатка: меньше линий лучше, затем крупнее средняя линия */
function scoreRemainderPlan(paths: Cabinet[][]): { lines: number; avgFill: number } {
  if (paths.length === 0) return { lines: Infinity, avgFill: 0 }
  const total = paths.reduce((sum, p) => sum + p.length, 0)
  return { lines: paths.length, avgFill: total / paths.length }
}

/**
 * Остаток: выбираем P-паттерн или короткие горизонтали — меньше линий / плотнее заполнение.
 */
function partitionRemainderBand(
  bandCabs: Cabinet[],
  config: ScreenConfig,
): Cabinet[][] {
  const maxSize = getMaxCabinetsPerPowerLine(config)
  const bandWidth =
    Math.max(...bandCabs.map((c) => c.col)) -
    Math.min(...bandCabs.map((c) => c.col)) +
    1
  const horizFill = Math.min(maxSize, Math.max(1, bandWidth))

  const pPaths = partitionBandPShape(bandCabs, config)
  const hPaths = partitionBandHorizontalStrips(bandCabs, config, horizFill)

  const pScore = scoreRemainderPlan(pPaths)
  const hScore = scoreRemainderPlan(hPaths)

  if (pScore.lines < hScore.lines) return pPaths
  if (hScore.lines < pScore.lines) return hPaths
  // Ничья по числу линий — берём план с большим средним заполнением;
  // при равенстве предпочитаем P (лучше использует узкий остаток).
  if (pScore.avgFill >= hScore.avgFill) return pPaths
  return hPaths
}

/**
 * 3.9 big/small: полосы по choosePowerPackWidth (preferred если ≤6 полных линий,
 * иначе max); в полной полосе — горизонтали снизу вверх; остаток — P или горизонтали.
 */
function partitionHorizontalStripComponent(
  component: Cabinet[],
  config: ScreenConfig,
): Cabinet[][] {
  const preferred = getPreferredCabinetsPerPowerLine(config)
  const maxSize = getMaxCabinetsPerPowerLine(config)
  const direction = edgeToDirection(config.chainStartEdge)
  const minCol = Math.min(...component.map((c) => c.col))
  const maxCol = Math.max(...component.map((c) => c.col))
  const minRow = Math.min(...component.map((c) => c.row))
  const maxRow = Math.max(...component.map((c) => c.row))
  const colsWide = maxCol - minCol + 1
  const rowsHigh = maxRow - minRow + 1
  const packWidth = choosePowerPackWidth(colsWide, rowsHigh, preferred, maxSize)
  const bands = getColumnBands(minCol, maxCol, packWidth, direction)
  const paths: Cabinet[][] = []

  for (const band of bands) {
    const bandCabs = component.filter(
      (c) => c.col >= band.colStart && c.col <= band.colEnd,
    )
    if (bandCabs.length === 0) continue

    const bandWidth = band.colEnd - band.colStart + 1
    if (bandWidth >= packWidth) {
      paths.push(...partitionBandHorizontalStrips(bandCabs, config, packWidth))
    } else {
      paths.push(...partitionRemainderBand(bandCabs, config))
    }
  }

  return paths
}

function partitionComponentForPreset(
  component: Cabinet[],
  config: ScreenConfig,
): Cabinet[][] {
  if (useHorizontalStripAlgorithm(config)) {
    return partitionHorizontalStripComponent(component, config)
  }
  return partitionComponent(component, config)
}

/** Кабинет в геометрическом центре линии (для center feed) */
export function getPowerLineCenterCabinet(cabinets: Cabinet[]): Cabinet {
  if (cabinets.length === 0) {
    throw new Error('getPowerLineCenterCabinet: empty cabinets')
  }
  if (cabinets.length === 1) return cabinets[0]

  const minCol = Math.min(...cabinets.map((c) => c.col))
  const maxCol = Math.max(...cabinets.map((c) => c.col))
  const minRow = Math.min(...cabinets.map((c) => c.row))
  const maxRow = Math.max(...cabinets.map((c) => c.row))
  const centerCol = (minCol + maxCol) / 2
  const centerRow = (minRow + maxRow) / 2

  return [...cabinets].sort((a, b) => {
    const distA = Math.abs(a.col - centerCol) + Math.abs(a.row - centerRow)
    const distB = Math.abs(b.col - centerCol) + Math.abs(b.row - centerRow)
    if (distA !== distB) return distA - distB
    return a.label.localeCompare(b.label)
  })[0]
}

/** Подпись источника силового trunk в ведомости */
export function getPowerTrunkSourceLabel(feedMode: ScreenConfig['powerFeedMode']): string {
  return feedMode === 'center' ? '32A Robot / PDU Distro' : 'PDU / Power Distro'
}

/** Точка подключения силового trunk для линии */
export function getPowerTrunkCabinet(
  line: PowerLine,
  feedMode: ScreenConfig['powerFeedMode'],
): Cabinet {
  if (feedMode === 'center') {
    return getPowerLineCenterCabinet(line.cabinets)
  }
  return line.cabinets[0]
}

/**
 * Авто-разбиение power: колонковые полосы + горизонтальные ряды (3.9 big/small),
 * вертикальный жадный обход (Reshet, 2.9).
 */
export function buildPowerLines(
  cabinets: Cabinet[],
  config: ScreenConfig,
  _isActive: CellActiveFn = () => true,
  emptySet?: Set<string>,
  _pixelsPerCabinet?: number,
): { lines: PowerLine[]; links: GridLink[]; cabinetsPerLine: number } {
  const preferred = getPreferredCabinetsPerPowerLine(config)
  const maxSize = getMaxCabinetsPerPowerLine(config)
  const active = emptySet
    ? cabinets.filter((c) => !emptySet.has(c.label))
    : cabinets

  const components = findPowerComponents(active, config)
  const lineGroups = new Map<number, Cabinet[]>()
  let lineNumber = 1
  let packWidth = preferred

  for (const component of components) {
    if (component.length > 0) {
      const minCol = Math.min(...component.map((c) => c.col))
      const maxCol = Math.max(...component.map((c) => c.col))
      const minRow = Math.min(...component.map((c) => c.row))
      const maxRow = Math.max(...component.map((c) => c.row))
      packWidth = choosePowerPackWidth(
        maxCol - minCol + 1,
        maxRow - minRow + 1,
        preferred,
        maxSize,
      )
    }
    const paths = partitionComponentForPreset(component, config)
    for (const path of paths) {
      if (path.length > 0) {
        lineGroups.set(lineNumber, path)
        lineNumber++
      }
    }
  }

  const startPoints: Record<number, string> = {}
  for (const [num, path] of lineGroups) {
    if (path.length > 0) startPoints[num] = path[0].label
  }

  const { lines, links } = buildLinesFromGroups(lineGroups, config, startPoints, true)
  return { lines, links, cabinetsPerLine: packWidth }
}

/** Строит линии питания из ручных назначений */
export function buildPowerLinesFromManual(
  cabinets: Cabinet[],
  assignments: Record<string, number>,
  config: ScreenConfig,
  startPoints: Record<number, string> = {},
  emptySet?: Set<string>,
  orderedChains?: Record<number, string[]>,
): { lines: PowerLine[]; links: GridLink[]; warnings: RoutingValidationWarning[] } {
  const lineGroups = new Map<number, Cabinet[]>()

  for (const cab of cabinets) {
    const line = assignments[cab.label]
    if (line == null || line < 1) continue
    if (emptySet?.has(cab.label)) continue
    const group = lineGroups.get(line) ?? []
    group.push(cab)
    lineGroups.set(line, group)
  }

  // Если есть упорядоченные цепочки кликов — собираем группы в этом порядке
  if (orderedChains && Object.keys(orderedChains).length > 0) {
    for (const [lineStr, labels] of Object.entries(orderedChains)) {
      const lineNumber = Number(lineStr)
      const byLabel = new Map((lineGroups.get(lineNumber) ?? []).map((c) => [c.label, c]))
      const ordered: Cabinet[] = []
      const seen = new Set<string>()
      for (const label of labels) {
        const cab = byLabel.get(label)
        if (cab && !seen.has(label)) {
          ordered.push(cab)
          seen.add(label)
        }
      }
      for (const cab of lineGroups.get(lineNumber) ?? []) {
        if (!seen.has(cab.label)) ordered.push(cab)
      }
      if (ordered.length > 0) lineGroups.set(lineNumber, ordered)
    }
    const { lines, links } = buildLinesFromGroups(lineGroups, config, startPoints, true)
    return { lines, links, warnings: validatePowerLines(lines, config) }
  }

  const { lines, links } = buildLinesFromGroups(lineGroups, config, startPoints)
  return { lines, links, warnings: validatePowerLines(lines, config) }
}

/** Алиас для routingEngine / UI */
export const buildManualPowerLines = buildPowerLinesFromManual

/** Извлекает точки старта из автоматически рассчитанных линий */
export function startPointsFromPowerLines(lines: PowerLine[]): Record<number, string> {
  const map: Record<number, string> = {}
  for (const line of lines) {
    if (line.cabinets.length > 0) {
      map[line.lineNumber] = line.cabinets[0].label
    }
  }
  return map
}

/** Извлекает назначения линий из автоматического расчёта */
export function assignmentsFromPowerLines(lines: PowerLine[]): Record<string, number> {
  const map: Record<string, number> = {}
  for (const line of lines) {
    for (const cab of line.cabinets) {
      map[cab.label] = line.lineNumber
    }
  }
  return map
}

/** Упорядоченные метки по линиям — для ручной схемы без авто-переупорядочивания */
export function orderedChainsFromPowerLines(lines: PowerLine[]): Record<number, string[]> {
  const map: Record<number, string[]> = {}
  for (const line of lines) {
    map[line.lineNumber] = line.cabinets.map((c) => c.label)
  }
  return map
}
