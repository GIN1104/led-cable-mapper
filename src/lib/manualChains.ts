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

/** Ключ для хеша маршрутизации: порядок внутри линий важен */
export function chainsKey(chains: Record<number, string[]> | undefined): string {
  if (!chains || Object.keys(chains).length === 0) return ''
  return Object.entries(chains)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([k, v]) => `${k}:${v.join('>')}`)
    .join(',')
}
