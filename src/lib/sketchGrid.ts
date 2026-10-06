/** Сетка кубиков с рисунка: row 0 — верх, как на стене */
export interface GridBoundsNorm {
  /** Доли ширины/высоты картинки 0…1 — куда попала решётка кубиков */
  left: number
  top: number
  right: number
  bottom: number
}

export interface GridCount {
  cabinetsWide: number
  cabinetsHigh: number
  /** Ширина ячейки / высота ячейки на рисунке */
  cellAspect: number
  /** true — кубик нарисован. Индекс [ряд][колонка], ряд 0 сверху */
  occupied: boolean[][]
  /** Область сетки на исходной картинке (для совпадающей разметки) */
  bounds?: GridBoundsNorm
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function boundsFromLines(
  vertical: number[],
  horizontal: number[],
  col0: number,
  row0: number,
  cols: number,
  rows: number,
  width: number,
  height: number,
): GridBoundsNorm | undefined {
  if (width < 1 || height < 1) return undefined
  const x0 = vertical[col0]
  const x1 = vertical[col0 + cols]
  const y0 = horizontal[row0]
  const y1 = horizontal[row0 + rows]
  if (
    x0 == null ||
    x1 == null ||
    y0 == null ||
    y1 == null ||
    !(x1 > x0) ||
    !(y1 > y0)
  ) {
    return undefined
  }
  return {
    left: clamp01(x0 / width),
    top: clamp01(y0 / height),
    right: clamp01(x1 / width),
    bottom: clamp01(y1 / height),
  }
}

function lineCenters(scores: number[], minScore: number): number[] {
  if (minScore < 1) return []
  const centers: number[] = []
  let start = -1
  for (let i = 0; i <= scores.length; i++) {
    const hot = i < scores.length && scores[i] >= minScore
    if (hot && start < 0) start = i
    if (!hot && start >= 0) {
      centers.push(Math.round((start + i - 1) / 2))
      start = -1
    }
  }
  return centers
}

/** Соседние штрихи одной рамки (двойная обводка) склеиваются в одну линию */
function mergeCloseLines(centers: number[]): number[] {
  if (centers.length < 3) return centers
  const gaps = centers.slice(1).map((value, index) => value - centers[index])
  const sorted = [...gaps].sort((a, b) => a - b)
  const typical = sorted[Math.floor(sorted.length * 0.65)]
  if (typical < 6) return centers
  const minGap = typical * 0.45
  const merged = [centers[0]]
  for (let i = 1; i < centers.length; i++) {
    if (centers[i] - merged[merged.length - 1] < minGap) {
      merged[merged.length - 1] = Math.round((merged[merged.length - 1] + centers[i]) / 2)
    } else {
      merged.push(centers[i])
    }
  }
  return merged
}

/** Самая длинная цепочка линий с одинаковым шагом — это сетка, а не размерные линии */
function regularChain(centers: number[]): number[] {
  if (centers.length < 2) return []
  const gaps = centers.slice(1).map((value, index) => value - centers[index])
  const sorted = [...gaps].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  if (median < 4) return []

  let best: number[] = []
  for (let start = 0; start < centers.length; start++) {
    const chain = [centers[start]]
    for (let i = start + 1; i < centers.length; i++) {
      const gap = centers[i] - chain[chain.length - 1]
      if (gap < median * 0.55) continue
      if (gap > median * 1.45) break
      if (gap >= median * 0.72 && gap <= median * 1.28) chain.push(centers[i])
    }
    if (chain.length > best.length) best = chain
  }
  return best.length >= 2 ? best : []
}

function medianGap(centers: number[]): number {
  const gaps = centers.slice(1).map((value, index) => value - centers[index])
  const sorted = [...gaps].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/** Самый частый шаг между линиями — сторона одного квадрата */
function dominantPitch(lines: number[]): number | null {
  const gaps: number[] = []
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i] - lines[i - 1]
    if (gap >= 5) gaps.push(gap)
  }
  if (gaps.length === 0) return null
  const sorted = [...gaps].sort((a, b) => a - b)
  const buckets: { sum: number; count: number; mid: number }[] = []
  for (const gap of sorted) {
    const last = buckets[buckets.length - 1]
    if (last && Math.abs(gap - last.mid) <= last.mid * 0.18) {
      last.sum += gap
      last.count += 1
      last.mid = last.sum / last.count
    } else {
      buckets.push({ sum: gap, count: 1, mid: gap })
    }
  }
  buckets.sort((a, b) => b.count - a.count || b.mid - a.mid)
  return buckets[0]?.mid ?? null
}

/**
 * Достраивает решётку в обе стороны, пока на оси ещё есть пик линии.
 * Раньше добавлялась только ±1 линия — половина стены часто обрезалась.
 */
function extendLatticeEnds(lines: number[], scores: number[], maxScore: number): number[] {
  if (lines.length < 2 || maxScore < 1) return lines
  const pitch = medianGap(lines)
  if (pitch < 4) return lines
  const minKeep = Math.max(2, maxScore * 0.14)
  const radius = Math.max(2, Math.round(pitch * 0.18))
  const peakAt = (pos: number) => {
    const center = Math.round(pos)
    let best = 0
    for (let i = center - radius; i <= center + radius; i++) {
      if (i >= 0 && i < scores.length) best = Math.max(best, scores[i])
    }
    return best
  }
  const next = [...lines]
  for (;;) {
    const before = next[0]! - pitch
    if (before < radius || peakAt(before) < minKeep) break
    next.unshift(Math.round(before))
    if (next.length > 120) break
  }
  for (;;) {
    const after = next[next.length - 1]! + pitch
    if (after > scores.length - radius || peakAt(after) < minKeep) break
    next.push(Math.round(after))
    if (next.length > 120) break
  }
  return next
}

/** Края одной толстой обводки или стрелки — это одна линия, не два ряда. */
function mergeTinyGaps(lines: number[], maxGap: number): number[] {
  if (lines.length < 2) return lines
  const merged = [lines[0]]
  for (let index = 1; index < lines.length; index++) {
    const last = merged[merged.length - 1]
    if (lines[index] - last <= maxGap) merged[merged.length - 1] = (last + lines[index]) / 2
    else merged.push(lines[index])
  }
  return merged
}

/**
 * Стрелка схемы идёт рядом с рамкой кубика: зазоры чередуются «короткий + длинный».
 * Шаг кубика — расстояние через одну линию. Лишнюю стрелку убираем.
 */
function dropMidlines(lines: number[]): number[] {
  if (lines.length < 6) return lines
  const gaps = lines.slice(1).map((_, index) => lines[index + 1] - lines[index])
  const buckets: { sum: number; count: number; mid: number }[] = []
  for (const gap of [...gaps].sort((a, b) => a - b)) {
    if (gap < 6) continue
    const last = buckets[buckets.length - 1]
    if (last && Math.abs(gap - last.mid) <= last.mid * 0.22) {
      last.sum += gap
      last.count += 1
      last.mid = last.sum / last.count
    } else {
      buckets.push({ sum: gap, count: 1, mid: gap })
    }
  }
  if (buckets.length < 2) return lines
  buckets.sort((a, b) => b.count - a.count)
  const first = buckets[0]
  const second = buckets[1]
  if (!first || !second || second.count < first.count * 0.6) return lines
  const small = Math.min(first.mid, second.mid)
  const large = Math.max(first.mid, second.mid)
  if (large < small * 1.4) return lines
  const hops: number[] = []
  for (let index = 0; index + 2 < lines.length; index++) {
    hops.push(lines[index + 2] - lines[index])
  }
  hops.sort((a, b) => a - b)
  const pitch = hops[Math.floor(hops.length / 2)] ?? small + large
  if (pitch < 12) return lines
  const origin = lines[0]
  const span = lines[lines.length - 1] - origin
  const steps = Math.round(span / pitch)
  if (steps < 2 || steps > 80) return lines
  if (Math.abs(span - steps * pitch) > pitch * 0.22) return lines
  const kept: number[] = []
  for (let index = 0; index <= steps; index++) {
    const expected = origin + index * pitch
    const near = lines.filter(
      (line) => Math.abs(line - expected) <= Math.min(small * 0.8, pitch * 0.15),
    )
    if (near.length === 0) continue
    kept.push(near.reduce((sum, value) => sum + value, 0) / near.length)
  }
  if (kept.length < steps * 0.75) return lines
  return kept
}

function expandFullLattice(lines: number[]): number[] {
  if (lines.length < 2) return lines
  const chain = regularChain(lines)
  const seed = chain.length >= 3 ? chain : lines
  const pitch = dominantPitch(seed) ?? medianGap(seed)
  if (!pitch || pitch < 4) return seed
  const origin = seed[0]
  const end = seed[seed.length - 1]
  const steps = Math.round((end - origin) / pitch)
  if (steps < 1 || steps > 80) return seed
  if (Math.abs(end - origin - steps * pitch) > pitch * 0.28) return seed
  return Array.from({ length: steps + 1 }, (_, index) => origin + index * pitch)
}

/**
 * Квадратные кубики (3.9 small): шаг рядов берём как шаг колонок.
 * Стрелки и полосы легенды дают ложный мелкий шаг по высоте — его отбрасываем.
 */
function latticeAtPitch(scores: number[], pitch: number): number[] {
  if (pitch < 4 || scores.length < pitch * 2) return []
  const radius = Math.max(2, Math.round(pitch * 0.18))
  const peakAt = (pos: number) => {
    const center = Math.round(pos)
    let best = 0
    for (let i = center - radius; i <= center + radius; i++) {
      if (i >= 0 && i < scores.length) best = Math.max(best, scores[i])
    }
    return best
  }
  const maxScore = scores.reduce((peak, value) => Math.max(peak, value), 0)
  if (maxScore < 1) return []
  const minKeep = Math.max(2, maxScore * 0.14)
  const softKeep = Math.max(2, maxScore * 0.1)

  let bestOrigin = 0
  let bestHits = -1
  const searchTo = Math.min(scores.length - 1, Math.ceil(pitch))
  for (let origin = 0; origin <= searchTo; origin++) {
    let hits = 0
    for (let pos = origin; pos < scores.length; pos += pitch) {
      const score = peakAt(pos)
      if (score >= minKeep) hits += score / maxScore
    }
    if (hits > bestHits) {
      bestHits = hits
      bestOrigin = origin
    }
  }

  const lines: number[] = []
  for (let pos = bestOrigin; pos < scores.length; pos += pitch) {
    if (peakAt(pos) < softKeep) continue
    let bestPos = Math.round(pos)
    let best = 0
    for (let i = Math.round(pos) - radius; i <= Math.round(pos) + radius; i++) {
      if (i >= 0 && i < scores.length && scores[i] > best) {
        best = scores[i]
        bestPos = i
      }
    }
    if (lines.length && bestPos - lines[lines.length - 1]! < pitch * 0.5) continue
    lines.push(bestPos)
  }
  if (lines.length < 2) return []

  let start = lines[0]!
  let end = lines[lines.length - 1]!
  // Дотягиваем края по мягкому порогу — иначе остаётся только «середина» стены
  while (start - pitch >= radius && peakAt(start - pitch) >= softKeep) start -= pitch
  while (end + pitch < scores.length - radius && peakAt(end + pitch) >= softKeep) end += pitch

  const steps = Math.round((end - start) / pitch)
  if (steps < 1 || steps > 100) return lines
  return Array.from({ length: steps + 1 }, (_, index) => Math.round(start + index * pitch))
}

function buildAxisLattice(scores: number[], maxScore: number, preferPitch?: number): number[] {
  if (maxScore < 1) return []
  const tiny = preferPitch ? Math.max(6, Math.round(preferPitch * 0.12)) : 8
  const centers = mergeCloseLines(
    dropMidlines(mergeTinyGaps(lineCenters(scores, maxScore * 0.18), tiny)),
  )
  let lattice: number[] = []
  if (preferPitch && preferPitch >= 8) {
    const squared = latticeAtPitch(scores, preferPitch)
    if (squared.length >= 3) lattice = squared
  }
  if (lattice.length < 3) {
    lattice = expandFullLattice(centers)
  }
  return extendLatticeEnds(lattice, scores, maxScore)
}

/** Длина самого длинного штриха. Дырки короче bridge считаются одной линией. */
function bridgedRunScores(
  ink: Uint8Array,
  width: number,
  height: number,
  axis: 'col' | 'row',
  bridge: number,
): number[] {
  const length = axis === 'col' ? width : height
  const scores = new Array<number>(length).fill(0)
  const along = axis === 'col' ? height : width
  for (let index = 0; index < length; index++) {
    let best = 0
    let run = 0
    let gap = 0
    for (let step = 0; step < along; step++) {
      const x = axis === 'col' ? index : step
      const y = axis === 'col' ? step : index
      if (ink[y * width + x]) {
        run += gap + 1
        gap = 0
        if (run > best) best = run
      } else {
        gap++
        if (gap > bridge) {
          run = 0
          gap = 0
        }
      }
    }
    scores[index] = best
  }
  return scores
}

function bandFraction(
  ink: Uint8Array,
  width: number,
  height: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): number {
  const xa = Math.max(0, Math.min(x0, x1))
  const xb = Math.min(width - 1, Math.max(x0, x1))
  const ya = Math.max(0, Math.min(y0, y1))
  const yb = Math.min(height - 1, Math.max(y0, y1))
  let total = 0
  let hits = 0
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      total++
      if (ink[y * width + x]) hits++
    }
  }
  return total ? hits / total : 0
}

function trimEmptyInfo(occupied: boolean[][]): {
  occupied: boolean[][]
  top: number
  left: number
} | null {
  if (!occupied.length || !occupied[0]?.length) return null
  let top = 0
  let bottom = occupied.length - 1
  let left = 0
  let right = occupied[0].length - 1
  const rowEmpty = (row: number) => occupied[row].every((cell) => !cell)
  const colEmpty = (col: number) => occupied.every((row) => !row[col])
  while (top <= bottom && rowEmpty(top)) top++
  while (bottom >= top && rowEmpty(bottom)) bottom--
  while (left <= right && colEmpty(left)) left++
  while (right >= left && colEmpty(right)) right--
  if (top > bottom || left > right) return null
  return {
    occupied: occupied.slice(top, bottom + 1).map((row) => row.slice(left, right + 1)),
    top,
    left,
  }
}

function buildInkMap(data: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const ink = new Uint8Array(width * height)
  const lumAt = (x: number, y: number) => {
    const index = (y * width + x) * 4
    return (data[index] + data[index + 1] + data[index + 2]) / 3
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const lum = lumAt(x, y)
      const right = x + 1 < width ? Math.abs(lum - lumAt(x + 1, y)) : 0
      const below = y + 1 < height ? Math.abs(lum - lumAt(x, y + 1)) : 0
      if (lum < 90 || right > 36 || below > 36) ink[y * width + x] = 1
    }
  }
  return ink
}

/**
 * Считает колонки и ряды кубиков по светлому рисунку с тёмной сеткой.
 * Возвращает null, если регулярной решётки не видно.
 */
export function countCabinetGrid(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): GridCount | null {
  if (width < 16 || height < 16) return null

  const ink = buildInkMap(data, width, height)

  // Сплошная линия рамки, а не сумма подписей: короткие штрихи букв не склеиваются,
  // а разрыв скруглённого угла (несколько пикселей) — склеивается.
  const bridge = Math.max(8, Math.round(Math.min(width, height) * 0.015))
  const colScore = bridgedRunScores(ink, width, height, 'col', bridge)
  const rowScore = bridgedRunScores(ink, width, height, 'row', bridge)
  const maxCol = colScore.reduce((peak, value) => Math.max(peak, value), 0)
  const maxRow = rowScore.reduce((peak, value) => Math.max(peak, value), 0)

  // Сначала колонки: на схеме стрелки горизонтальные, вертикали чище.
  const vertical = buildAxisLattice(colScore, maxCol)
  if (vertical.length < 2) return null
  const pitchX = medianGap(vertical)
  const horizontal = buildAxisLattice(rowScore, maxRow, pitchX)
  if (horizontal.length < 2) return null
  const gapX = medianGap(vertical)
  const gapY = medianGap(horizontal)
  if (gapX < 4 || gapY < 4) return null

  const occupied: boolean[][] = []
  for (let row = 0; row < horizontal.length - 1; row++) {
    const y0 = horizontal[row]
    const y1 = horizontal[row + 1]
    const line: boolean[] = []
    for (let col = 0; col < vertical.length - 1; col++) {
      const x0 = vertical[col]
      const x1 = vertical[col + 1]
      const band = Math.max(2, Math.round(Math.min(gapX, gapY) * 0.14))
      const top = bandFraction(ink, width, height, x0, x1, y0 - band, y0 + band)
      const bottom = bandFraction(ink, width, height, x0, x1, y1 - band, y1 + band)
      const left = bandFraction(ink, width, height, x0 - band, x0 + band, y0, y1)
      const right = bandFraction(ink, width, height, x1 - band, x1 + band, y0, y1)
      const sides = [top, right, bottom, left].filter((value) => value >= 0.28).length
      // Квадрат с линиями — кубик. Дырка — только если своего квадрата нет.
      // Двух общих сторон с соседом мало: иначе пустая клетка у края становится «кубиком».
      line.push(sides >= 3)
    }
    occupied.push(line)
  }

  const anySquare = occupied.some((row) => row.some(Boolean))
  const gridCells = anySquare
    ? occupied
    : occupied.map((row) => row.map(() => true))
  const trimmedInfo = trimEmptyInfo(gridCells)
  const wide = vertical.length - 1
  const high = horizontal.length - 1
  if (!trimmedInfo || trimmedInfo.occupied.length * (trimmedInfo.occupied[0]?.length ?? 0) < 4) {
    if (wide * high < 4) return null
    return {
      cabinetsWide: wide,
      cabinetsHigh: high,
      cellAspect: gapX / gapY,
      occupied: Array.from({ length: high }, () => Array.from({ length: wide }, () => true)),
      bounds: boundsFromLines(vertical, horizontal, 0, 0, wide, high, width, height),
    }
  }

  const trimmedWide = trimmedInfo.occupied[0]!.length
  const trimmedHigh = trimmedInfo.occupied.length
  return {
    cabinetsWide: trimmedWide,
    cabinetsHigh: trimmedHigh,
    cellAspect: gapX / gapY,
    occupied: trimmedInfo.occupied,
    bounds: boundsFromLines(
      vertical,
      horizontal,
      trimmedInfo.left,
      trimmedInfo.top,
      trimmedWide,
      trimmedHigh,
      width,
      height,
    ),
  }
}

function windowScore(occupied: boolean[][]): number {
  let score = 0
  const rows = occupied.length
  const cols = occupied[0]?.length ?? 0
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (!occupied[row][col]) continue
      const edge = row === 0 || row === rows - 1 || col === 0 || col === cols - 1
      score += edge ? 3 : 1
    }
  }
  return score
}

/**
 * Сетка уже известна: cols × rows.
 * Берётся решётка линий, а не рамка всего рисунка: иначе поля и подписи
 * становятся «пустым кольцом» вокруг настоящих кубиков.
 */
export function occupiedForFixedCounts(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cols: number,
  rows: number,
): boolean[][] {
  const filled = Array.from({ length: rows }, () => Array.from({ length: cols }, () => true))
  if (cols < 1 || rows < 1 || width < 8 || height < 8) return filled
  const grid = countCabinetGrid(data, width, height)
  if (!grid) return filled
  if (grid.cabinetsWide === cols && grid.cabinetsHigh === rows) {
    return grid.occupied.map((row) => [...row])
  }
  if (grid.cabinetsWide < cols || grid.cabinetsHigh < rows) return filled

  let bestScore = -1
  let best = filled
  for (let row0 = 0; row0 <= grid.cabinetsHigh - rows; row0++) {
    for (let col0 = 0; col0 <= grid.cabinetsWide - cols; col0++) {
      const window: boolean[][] = []
      for (let row = 0; row < rows; row++) {
        window.push(grid.occupied[row0 + row].slice(col0, col0 + cols))
      }
      const score = windowScore(window)
      if (score > bestScore) {
        bestScore = score
        best = window
      }
    }
  }
  return best
}

/**
 * Занятость клеток внутри рамки пользователя (доли 0…1).
 * Главное — оценка каждой клетки cols×rows в рамке (есть свой квадрат или нет).
 * Глобальная решётка только подсказывает, если уже нашла дырки.
 */
export function occupiedWithinBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cols: number,
  rows: number,
  bounds: GridBoundsNorm,
): boolean[][] {
  const filled = Array.from({ length: rows }, () => Array.from({ length: cols }, () => true))
  if (cols < 1 || rows < 1 || width < 8 || height < 8) return filled

  const frameL = clamp01(bounds.left) * width
  const frameT = clamp01(bounds.top) * height
  const frameR = clamp01(bounds.right) * width
  const frameB = clamp01(bounds.bottom) * height
  const frameW = frameR - frameL
  const frameH = frameB - frameT
  if (frameW < cols * 4 || frameH < rows * 4) return filled

  // Подсказка с полной страницы — только если там реально есть дырки нужного размера
  const fullGrid = countCabinetGrid(data, width, height)
  if (fullGrid && fullGrid.cabinetsWide === cols && fullGrid.cabinetsHigh === rows) {
    const holes = fullGrid.occupied.flat().filter((cell) => !cell).length
    if (holes > 0) return fullGrid.occupied.map((row) => [...row])
  }
  if (fullGrid && fullGrid.cabinetsWide >= cols && fullGrid.cabinetsHigh >= rows) {
    let bestScore = -1
    let best: boolean[][] | null = null
    for (let row0 = 0; row0 <= fullGrid.cabinetsHigh - rows; row0++) {
      for (let col0 = 0; col0 <= fullGrid.cabinetsWide - cols; col0++) {
        const window: boolean[][] = []
        for (let row = 0; row < rows; row++) {
          window.push(fullGrid.occupied[row0 + row].slice(col0, col0 + cols))
        }
        const holes = window.flat().filter((cell) => !cell).length
        if (holes < 1) continue
        const score = windowScore(window) + holes * 4
        if (score > bestScore) {
          bestScore = score
          best = window
        }
      }
    }
    if (best) return best
  }

  // Основной путь: ink по клеткам рамки (как видит глаз — квадрат есть / нет)
  const ink = buildInkMap(data, width, height)
  const cellW = frameW / cols
  const cellH = frameH / rows
  const band = Math.max(2, Math.round(Math.min(cellW, cellH) * 0.11))
  const insetX = Math.max(1, cellW * 0.22)
  const insetY = Math.max(1, cellH * 0.22)

  type CellScore = { sides: number; ring: number; interior: number }
  const scores: CellScore[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx0 = frameL + col * cellW
      const cx1 = frameL + (col + 1) * cellW
      const cy0 = frameT + row * cellH
      const cy1 = frameT + (row + 1) * cellH
      const top = bandFraction(ink, width, height, cx0 + insetX, cx1 - insetX, cy0 - band, cy0 + band)
      const bottom = bandFraction(ink, width, height, cx0 + insetX, cx1 - insetX, cy1 - band, cy1 + band)
      const left = bandFraction(ink, width, height, cx0 - band, cx0 + band, cy0 + insetY, cy1 - insetY)
      const right = bandFraction(ink, width, height, cx1 - band, cx1 + band, cy0 + insetY, cy1 - insetY)
      const sideVals = [top, right, bottom, left]
      const sides = sideVals.filter((value) => value >= 0.22).length
      const ring = sideVals.reduce((sum, value) => sum + value, 0) / 4
      const interior = bandFraction(
        ink,
        width,
        height,
        cx0 + cellW * 0.28,
        cx1 - cellW * 0.28,
        cy0 + cellH * 0.28,
        cy1 - cellH * 0.28,
      )
      scores.push({ sides, ring, interior })
    }
  }

  // Комбинированный балл: свой квадрат (стороны) важнее заливки
  const strength = scores.map((s) => s.ring * 0.75 + Math.min(1, s.sides / 4) * 0.25 + s.interior * 0.15)
  const occupiedFlat = splitOccupiedByGap(strength, (value) => value >= 0.2)

  // Жёсткое правило: < 3 сторон — почти наверняка дырка (отдельные кубики без общей решётки)
  for (let i = 0; i < scores.length; i++) {
    if (scores[i]!.sides < 3) occupiedFlat[i] = false
    if (scores[i]!.sides >= 3 && scores[i]!.ring >= 0.35) occupiedFlat[i] = true
  }

  const occupied: boolean[][] = []
  let i = 0
  for (let row = 0; row < rows; row++) {
    const line: boolean[] = []
    for (let col = 0; col < cols; col++) {
      line.push(occupiedFlat[i++] !== false)
    }
    occupied.push(line)
  }

  const anyOn = occupied.some((row) => row.some(Boolean))
  const anyOff = occupied.some((row) => row.some((cell) => !cell))
  if (anyOn && anyOff) return occupied
  if (anyOn) return occupied

  // Совсем ничего не нашли — не оставляем «всё пусто», иначе схема ломается
  return filled
}

/** Делит клетки на занятые/пустые по наибольшему разрыву в оценках */
function splitOccupiedByGap(scores: number[], absoluteFallback: (value: number) => boolean): boolean[] {
  if (scores.length === 0) return []
  if (scores.length === 1) return [absoluteFallback(scores[0]!)]

  const indexed = scores.map((value, index) => ({ value, index }))
  indexed.sort((a, b) => a.value - b.value)

  let bestGap = 0
  let bestAt = 0
  for (let i = 1; i < indexed.length; i++) {
    const gap = indexed[i]!.value - indexed[i - 1]!.value
    // Разрыв ближе к середине списка предпочтительнее (и дырки, и кубики)
    const balance = 1 - Math.abs(i / indexed.length - 0.5)
    const weighted = gap * (0.65 + 0.35 * balance)
    if (weighted > bestGap) {
      bestGap = weighted
      bestAt = i
    }
  }

  const result = Array.from({ length: scores.length }, () => true)
  // Явный разрыв между «слабыми» и «сильными» клетками
  if (bestGap >= 0.045 && bestAt > 0 && bestAt < indexed.length) {
    const lo = indexed[bestAt - 1]!.value
    const hi = indexed[bestAt]!.value
    const threshold = (lo + hi) / 2
    for (let i = 0; i < scores.length; i++) {
      result[i] = scores[i]! >= threshold
    }
    // Не выкидываем почти всё: если «занятых» < 20%, порог слишком жёсткий
    const on = result.filter(Boolean).length
    if (on >= Math.max(1, Math.floor(scores.length * 0.2)) && on < scores.length) {
      return result
    }
  }

  return scores.map(absoluteFallback)
}

/** Отрезок оси: почти горизонтальный или почти вертикальный */
export interface AxisSegment {
  x1: number
  y1: number
  x2: number
  y2: number
}

function clusterPositions(values: number[], tolerance: number): number[] {
  if (!values.length) return []
  const sorted = [...values].sort((a, b) => a - b)
  const groups: number[][] = [[sorted[0]]]
  for (let i = 1; i < sorted.length; i++) {
    const group = groups[groups.length - 1]
    if (sorted[i] - group[group.length - 1] <= tolerance) group.push(sorted[i])
    else groups.push([sorted[i]])
  }
  return groups.map((group) => group.reduce((sum, value) => sum + value, 0) / group.length)
}

function coverHorizontal(segments: AxisSegment[], y: number, x0: number, x1: number, tolerance: number): number {
  const span = Math.max(1, x1 - x0)
  let covered = 0
  for (const segment of segments) {
    if (Math.abs(segment.y1 - segment.y2) > tolerance) continue
    if (Math.abs((segment.y1 + segment.y2) / 2 - y) > tolerance) continue
    const left = Math.max(Math.min(segment.x1, segment.x2), x0)
    const right = Math.min(Math.max(segment.x1, segment.x2), x1)
    if (right > left) covered += right - left
  }
  return Math.min(1, covered / span)
}

function coverVertical(segments: AxisSegment[], x: number, y0: number, y1: number, tolerance: number): number {
  const span = Math.max(1, y1 - y0)
  let covered = 0
  for (const segment of segments) {
    if (Math.abs(segment.x1 - segment.x2) > tolerance) continue
    if (Math.abs((segment.x1 + segment.x2) / 2 - x) > tolerance) continue
    const top = Math.max(Math.min(segment.y1, segment.y2), y0)
    const bottom = Math.min(Math.max(segment.y1, segment.y2), y1)
    if (bottom > top) covered += bottom - top
  }
  return Math.min(1, covered / span)
}

/**
 * Сетка по точным отрезкам (вектор PDF).
 * Горизонталь и вертикаль не «плывут», как на растре.
 * @param pageSize размер страницы в тех же единицах, что и сегменты (viewport)
 */
export function gridFromAxisSegments(
  segments: AxisSegment[],
  pageSize?: { width: number; height: number },
): GridCount | null {
  const horizontal = segments.filter((segment) => {
    const length = Math.abs(segment.x2 - segment.x1)
    return length >= 8 && Math.abs(segment.y2 - segment.y1) <= Math.max(1.5, length * 0.04)
  })
  const vertical = segments.filter((segment) => {
    const length = Math.abs(segment.y2 - segment.y1)
    return length >= 8 && Math.abs(segment.x2 - segment.x1) <= Math.max(1.5, length * 0.04)
  })
  if (horizontal.length < 3 || vertical.length < 3) return null

  const ys = clusterPositions(horizontal.map((segment) => (segment.y1 + segment.y2) / 2), 2.2)
  const xs = clusterPositions(vertical.map((segment) => (segment.x1 + segment.x2) / 2), 2.2)
  const yLines = expandFullLattice(ys)
  const xLines = expandFullLattice(xs)
  if (xLines.length < 2 || yLines.length < 2) return null

  const gapX = medianGap(xLines)
  const gapY = medianGap(yLines)
  if (gapX < 6 || gapY < 6) return null

  const occupied: boolean[][] = []
  const tolerance = Math.max(2.2, Math.min(gapX, gapY) * 0.12)
  for (let row = 0; row < yLines.length - 1; row++) {
    const y0 = yLines[row]
    const y1 = yLines[row + 1]
    const line: boolean[] = []
    for (let col = 0; col < xLines.length - 1; col++) {
      const x0 = xLines[col]
      const x1 = xLines[col + 1]
      const sides = [
        coverHorizontal(horizontal, y0, x0, x1, tolerance),
        coverHorizontal(horizontal, y1, x0, x1, tolerance),
        coverVertical(vertical, x0, y0, y1, tolerance),
        coverVertical(vertical, x1, y0, y1, tolerance),
      ].filter((value) => value >= 0.45).length
      line.push(sides >= 3)
    }
    occupied.push(line)
  }

  const trimmedInfo = trimEmptyInfo(occupied)
  if (
    !trimmedInfo ||
    trimmedInfo.occupied.length * (trimmedInfo.occupied[0]?.length ?? 0) < 4
  ) {
    return null
  }
  const trimmedWide = trimmedInfo.occupied[0]!.length
  const trimmedHigh = trimmedInfo.occupied.length
  const width =
    pageSize?.width ??
    Math.max(
      ...segments.map((segment) => Math.max(segment.x1, segment.x2)),
      xLines[xLines.length - 1] ?? 0,
    )
  const height =
    pageSize?.height ??
    Math.max(
      ...segments.map((segment) => Math.max(segment.y1, segment.y2)),
      yLines[yLines.length - 1] ?? 0,
    )
  return {
    cabinetsWide: trimmedWide,
    cabinetsHigh: trimmedHigh,
    cellAspect: gapX / gapY,
    occupied: trimmedInfo.occupied,
    bounds: boundsFromLines(
      xLines,
      yLines,
      trimmedInfo.left,
      trimmedInfo.top,
      trimmedWide,
      trimmedHigh,
      width,
      height,
    ),
  }
}

/** Сколько нарисованных кубиков — чтобы сравнить вектор и картинку */
export function gridFilledCount(grid: GridCount | null): number {
  if (!grid) return 0
  let count = 0
  for (const row of grid.occupied) {
    for (const cell of row) if (cell) count++
  }
  return count
}
