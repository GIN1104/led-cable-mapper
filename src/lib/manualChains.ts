/** Мутации упорядоченных цепочек ручной схемы (порядок кликов Paint) */

/** Удаляет метку из всех цепочек */
export function removeLabelFromChains(
  chains: Record<number, string[]>,
  label: string,
): Record<number, string[]> {
  const next: Record<number, string[]> = {}
  for (const [key, list] of Object.entries(chains)) {
    const filtered = list.filter((l) => l !== label)
    if (filtered.length > 0) next[Number(key)] = filtered
  }
  return next
}

/** Убирает метку из старых цепочек и добавляет в конец целевой линии */
export function appendLabelToChain(
  chains: Record<number, string[]>,
  label: string,
  line: number,
): Record<number, string[]> {
  const without = removeLabelFromChains(chains, label)
  return {
    ...without,
    [line]: [...(without[line] ?? []), label],
  }
}

/** Ставит метку первой в цепочке линии (Set Start) */
export function moveLabelToChainFront(
  chains: Record<number, string[]>,
  label: string,
  line: number,
): Record<number, string[]> {
  const without = removeLabelFromChains(chains, label)
  return {
    ...without,
    [line]: [label, ...(without[line] ?? [])],
  }
}

/** Собирает label→номер из упорядоченных цепочек */
export function assignmentsFromChains(
  chains: Record<number, string[]>,
): Record<string, number> {
  const map: Record<string, number> = {}
  for (const [line, labels] of Object.entries(chains)) {
    const n = Number(line)
    for (const label of labels) {
      map[label] = n
    }
  }
  return map
}

/** Точки старта = первый кабинет каждой цепочки */
export function startPointsFromChains(
  chains: Record<number, string[]>,
): Record<number, string> {
  const map: Record<number, string> = {}
  for (const [line, labels] of Object.entries(chains)) {
    if (labels.length > 0) map[Number(line)] = labels[0]
  }
  return map
}

/** Очищает одну линию: удаляет цепочку и возвращает снятые метки */
export function clearChain(
  chains: Record<number, string[]>,
  line: number,
): { chains: Record<number, string[]>; labels: string[] } {
  const chain = chains[line] ?? []
  if (chain.length === 0) return { chains, labels: [] }
  const next = { ...chains }
  delete next[line]
  return { chains: next, labels: [...chain] }
}

/** Переворачивает цепочку одной линии: первый кабинет → последний */
export function reverseChain(
  chains: Record<number, string[]>,
  line: number,
): Record<number, string[]> {
  const chain = chains[line]
  if (!chain || chain.length < 2) return chains
  return {
    ...chains,
    [line]: [...chain].reverse(),
  }
}

/** Максимальный номер линии при перенумерации */
export const MANUAL_LINE_NUMBER_MAX = 99

/** Верхняя граница номера линии: max(существующие, maxAssignable) + 5, но не выше 99 */
export function maxRenumberLine(
  chains: Record<number, string[]>,
  maxAssignable: number,
): number {
  const existingMax =
    Object.keys(chains).length > 0
      ? Math.max(...Object.keys(chains).map(Number))
      : 0
  return Math.min(
    MANUAL_LINE_NUMBER_MAX,
    Math.max(maxAssignable, existingMax) + 5,
  )
}

export interface RenumberLineResult {
  chains: Record<number, string[]>
  startPoints: Record<number, string>
  assignments: Record<string, number>
}

/**
 * Все кабинеты линии: порядок из цепочки + «осиротевшие» метки из assignments
 * (те, у кого номер линии есть в карте, но их нет в chain — иначе перенумерация
 * затронула бы только часть линии / один кубик).
 */
export function labelsForLine(
  chains: Record<number, string[]>,
  assignments: Record<string, number>,
  line: number,
): string[] {
  const chain = chains[line] ?? []
  const ordered = [...chain]
  const seen = new Set(chain)
  for (const [label, n] of Object.entries(assignments)) {
    if (n === line && !seen.has(label)) {
      ordered.push(label)
      seen.add(label)
    }
  }
  return ordered
}

/**
 * Перенумеровать линию from → to (вся линия целиком).
 * - Целевая занята → обмен (swap) содержимым и start points.
 * - Целевая пуста → перенос цепочки и start point.
 * - Исходная пуста → без изменений данных (только смена активной линии в UI).
 * Обновляет assignment у КАЖДОГО кабинета линии (chain + orphans в assignments).
 */
export function renumberLine(
  chains: Record<number, string[]>,
  startPoints: Record<number, string>,
  assignments: Record<string, number>,
  from: number,
  to: number,
): RenumberLineResult | null {
  if (from < 1 || to < 1 || from === to) return null

  const fromChain = labelsForLine(chains, assignments, from)
  const toChain = labelsForLine(chains, assignments, to)
  const hasFrom = fromChain.length > 0
  const hasTo = toChain.length > 0

  const nextChains = { ...chains }
  const nextStart = { ...startPoints }
  const nextAssignments = { ...assignments }

  if (hasFrom && hasTo) {
    nextChains[from] = [...toChain]
    nextChains[to] = [...fromChain]
    for (const label of toChain) nextAssignments[label] = from
    for (const label of fromChain) nextAssignments[label] = to
    const fromStart = startPoints[from] ?? fromChain[0]
    const toStart = startPoints[to] ?? toChain[0]
    if (fromStart !== undefined && toStart !== undefined) {
      nextStart[from] = toStart
      nextStart[to] = fromStart
    } else if (fromStart !== undefined) {
      delete nextStart[from]
      nextStart[to] = fromStart
    } else if (toStart !== undefined) {
      nextStart[from] = toStart
      delete nextStart[to]
    } else {
      delete nextStart[from]
      delete nextStart[to]
    }
  } else if (hasFrom) {
    nextChains[to] = [...fromChain]
    delete nextChains[from]
    for (const label of fromChain) nextAssignments[label] = to
    const fromStart = startPoints[from] ?? fromChain[0]
    if (fromStart !== undefined) {
      nextStart[to] = fromStart
      delete nextStart[from]
    } else {
      delete nextStart[to]
    }
  }

  if ((nextChains[from]?.length ?? 0) === 0) delete nextChains[from]
  if ((nextChains[to]?.length ?? 0) === 0) delete nextChains[to]

  // Страховка: номер в assignments всегда совпадает с цепочкой
  for (const [lineStr, labels] of Object.entries(nextChains)) {
    const n = Number(lineStr)
    for (const label of labels) nextAssignments[label] = n
  }

  return {
    chains: nextChains,
    startPoints: nextStart,
    assignments: nextAssignments,
  }
}

/** Ключ для хеша маршрутизации: порядок внутри линий важен */
export function chainsKey(chains: Record<number, string[]> | undefined): string {
  if (!chains || Object.keys(chains).length === 0) return ''
  return Object.entries(chains)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([k, v]) => `${k}:${v.join('>')}`)
    .join(',')
}
