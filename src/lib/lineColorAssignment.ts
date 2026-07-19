import type { Cabinet } from '../types'
import {
  DATA_LINE_PALETTE,
  POWER_LINE_PALETTE,
  basePaletteSize,
  colorSetByIndex,
  type LineColorSet,
  type LineColorMode,
} from './lineColors'

/** Соседние линии: кабинеты разных линий касаются по стороне */
export function buildLineAdjacency(
  cabinets: Cabinet[],
  lineOfCabinet: Map<string, number>,
): Map<number, Set<number>> {
  const adj = new Map<number, Set<number>>()
  const byPos = new Map<string, Cabinet>()
  for (const cab of cabinets) byPos.set(`${cab.col},${cab.row}`, cab)

  const link = (a: number, b: number) => {
    if (a === b) return
    if (!adj.has(a)) adj.set(a, new Set())
    if (!adj.has(b)) adj.set(b, new Set())
    adj.get(a)!.add(b)
    adj.get(b)!.add(a)
  }

  for (const cab of cabinets) {
    const lineA = lineOfCabinet.get(cab.label)
    if (lineA == null) continue
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const other = byPos.get(`${cab.col + dc},${cab.row + dr}`)
      if (!other) continue
      const lineB = lineOfCabinet.get(other.label)
      if (lineB != null) link(lineA, lineB)
    }
  }
  return adj
}

function paletteSize(mode: LineColorMode, lineCount = 0): number {
  const base = basePaletteSize(mode)
  // Data: всегда хватает уникальных слотов (procedural за палитрой)
  if (mode === 'data') return Math.max(base, lineCount)
  return base
}

/**
 * Назначает индексы палитры линиям.
 * Data: каждая линия — свой уникальный цвет (+ соседние на сетке не из одной семьи).
 * Power: как раньше — без совпадений у соседей.
 */
export function assignDistinctLineColors(
  lineIds: number[],
  adjacency: Map<number, Set<number>>,
  mode: LineColorMode,
  manualColors?: Record<number, number>,
): Map<number, number> {
  const size = paletteSize(mode, lineIds.length)
  const result = new Map<number, number>()
  const used = new Set<number>()

  for (const id of lineIds) {
    const manual = manualColors?.[id]
    if (
      manual != null &&
      Number.isFinite(manual) &&
      manual >= 0 &&
      (mode !== 'data' || manual < size)
    ) {
      const idx =
        mode === 'data'
          ? Math.min(Math.floor(manual), size - 1)
          : ((manual % basePaletteSize(mode)) + basePaletteSize(mode)) %
            basePaletteSize(mode)
      // Data: ручной цвет тоже уникален — если занят, сдвинем ниже
      if (mode === 'data' && used.has(idx)) continue
      result.set(id, idx)
      used.add(idx)
    }
  }

  const sorted = [...lineIds].sort(
    (a, b) => (adjacency.get(b)?.size ?? 0) - (adjacency.get(a)?.size ?? 0),
  )

  for (const id of sorted) {
    if (result.has(id)) continue

    const neighborForbidden = new Set<number>()
    for (const neighbor of adjacency.get(id) ?? []) {
      const c = result.get(neighbor)
      if (c == null) continue
      neighborForbidden.add(c)
      if (c - 1 >= 0) neighborForbidden.add(c - 1)
      if (c + 1 < size) neighborForbidden.add(c + 1)
    }

    let picked = -1
    // 1) свободен глобально и не соседний оттенок
    for (let i = 0; i < size; i++) {
      if (!used.has(i) && !neighborForbidden.has(i)) {
        picked = i
        break
      }
    }
    // 2) любой ещё не использованный (тикошрет: все линии разные)
    if (picked < 0) {
      for (let i = 0; i < size; i++) {
        if (!used.has(i)) {
          picked = i
          break
        }
      }
    }
    // 3) power fallback / крайний случай
    if (picked < 0) {
      for (let i = 0; i < size; i++) {
        if (!neighborForbidden.has(i)) {
          picked = i
          break
        }
      }
    }
    if (picked < 0) picked = (id - 1) % size

    result.set(id, picked)
    used.add(picked)
  }

  return result
}

export function computeLineColorMap(
  mode: LineColorMode,
  cabinets: Cabinet[],
  lineOfCabinet: Map<string, number>,
  lineIds: number[],
  manualColors?: Record<number, number>,
): Map<number, number> {
  if (lineIds.length === 0) return new Map()
  const adjacency = buildLineAdjacency(cabinets, lineOfCabinet)
  return assignDistinctLineColors(lineIds, adjacency, mode, manualColors)
}

export function lineColorFromMap(
  mode: LineColorMode,
  lineId: number,
  colorMap: Map<number, number>,
): LineColorSet {
  if (lineId <= 0) {
    return mode === 'data'
      ? colorSetByIndex('data', 0)
      : { fill: 'transparent', stroke: '#cbd5e1', label: '#64748b', arrow: '#64748b' }
  }
  const idx = colorMap.get(lineId)
  if (idx != null) return colorSetByIndex(mode, idx)
  return colorSetByIndex(mode, (lineId - 1) % basePaletteSize(mode))
}

/** Первый свободный цвет для линии (уникальный + не как у соседей) */
export function suggestLineColorIndex(
  lineId: number,
  mode: LineColorMode,
  cabinets: Cabinet[],
  lineOfCabinet: Map<string, number>,
  manualColors?: Record<number, number>,
): number {
  const adjacency = buildLineAdjacency(cabinets, lineOfCabinet)
  const lineIds = [...new Set([...lineOfCabinet.values(), lineId])].filter((n) => n > 0)
  const size = paletteSize(mode, Math.max(lineIds.length, lineId))
  const used = new Set<number>()
  for (const [lid, idx] of Object.entries(manualColors ?? {})) {
    if (Number(lid) === lineId) continue
    if (idx >= 0 && idx < size) used.add(idx)
  }
  // Уже назначенные соседям по умолчанию
  for (const neighbor of adjacency.get(lineId) ?? []) {
    const manual = manualColors?.[neighbor]
    if (manual != null && manual >= 0 && manual < size) used.add(manual)
  }

  const neighborForbidden = new Set<number>(used)
  for (const neighbor of adjacency.get(lineId) ?? []) {
    const manual = manualColors?.[neighbor]
    const idx =
      manual != null && manual >= 0 && manual < size
        ? manual
        : (neighbor - 1) % basePaletteSize(mode)
    neighborForbidden.add(idx)
    if (idx - 1 >= 0) neighborForbidden.add(idx - 1)
    if (idx + 1 < size) neighborForbidden.add(idx + 1)
  }

  for (let i = 0; i < size; i++) {
    if (!used.has(i) && !neighborForbidden.has(i)) return i
  }
  for (let i = 0; i < size; i++) {
    if (!used.has(i)) return i
  }
  return (lineId - 1) % size
}

export function paletteSwatches(mode: LineColorMode): LineColorSet[] {
  return mode === 'data' ? DATA_LINE_PALETTE : POWER_LINE_PALETTE
}

/** Перенумерация ручных цветов при move/swap линии */
export function remapLineColorOverrides(
  colors: Record<number, number> | undefined,
  from: number,
  to: number,
  swapped: boolean,
): Record<number, number> | undefined {
  if (!colors || Object.keys(colors).length === 0) return colors
  const next = { ...colors }
  const fromVal = next[from]
  const toVal = next[to]
  if (fromVal !== undefined) {
    next[to] = fromVal
    delete next[from]
  }
  if (swapped && toVal !== undefined) {
    next[from] = toVal
  }
  return next
}
