import type { DataChain, ScreenConfig } from '../types'
import {
  normalizeStripControllerIds,
  normalizeStripWidths,
  stripColumnRanges,
} from './cabinetGrid'

/** Колонка из метки кабинета (A1 → 0) */
export function colFromCabinetLabel(label: string): number | null {
  const match = /^([A-Z]+)(\d+)$/.exec(label.trim())
  if (!match?.[2]) return null
  const n = Number.parseInt(match[2], 10)
  return Number.isFinite(n) && n >= 1 ? n - 1 : null
}

/** Какой VX1000 обслуживает колонку по настройке стрипов */
export function controllerForCol(
  col: number,
  stripWidths: number[],
  stripControllerIds: number[],
): number {
  for (const { startCol, endCol, index } of stripColumnRanges(stripWidths)) {
    if (col >= startCol && col < endCol) {
      const id = stripControllerIds[index] ?? 1
      return id === 2 ? 2 : 1
    }
  }
  return 1
}

/** VX по метке кабинета и конфигу экрана */
export function inferControllerFromLabel(label: string, config: ScreenConfig): number {
  const col = colFromCabinetLabel(label)
  if (col == null) return 1
  const stripWidths = normalizeStripWidths(config.stripWidths, config.cabinetsWide)
  const stripControllerIds = normalizeStripControllerIds(
    config.stripControllerIds,
    stripWidths.length,
  )
  return controllerForCol(col, stripWidths, stripControllerIds)
}

/** Авто: по большинству кабинетов линии на каком стрипе / VX */
export function inferControllerForPort(
  chain: DataChain,
  stripWidths: number[],
  stripControllerIds: number[],
): number {
  const votes = new Map<number, number>()
  for (const cab of chain.cabinets) {
    const cid = controllerForCol(cab.col, stripWidths, stripControllerIds)
    votes.set(cid, (votes.get(cid) ?? 0) + 1)
  }
  if (votes.size === 0 && chain.cabinets[0]?.label) {
    const col = colFromCabinetLabel(chain.cabinets[0].label)
    if (col != null) return controllerForCol(col, stripWidths, stripControllerIds)
  }
  let best = 1
  let max = 0
  for (const [cid, count] of votes) {
    if (count > max) {
      max = count
      best = cid
    }
  }
  return best
}

/** Нумерация D1-1 / D2-1 для data-линий при 2× VX1000 */
export function enrichDataChainsWithDualVx(
  chains: DataChain[],
  config: ScreenConfig,
  manualControllers?: Record<number, number>,
): DataChain[] {
  const stripWidths = normalizeStripWidths(config.stripWidths, config.cabinetsWide)
  if (!config.dualVx1000 || stripWidths.length <= 1) return chains

  const stripControllerIds = normalizeStripControllerIds(
    config.stripControllerIds,
    stripWidths.length,
  )

  const mains = chains.filter((c) => !c.isBackup)
  const portController = new Map<number, number>()

  for (const chain of mains) {
    const manual = manualControllers?.[chain.portNumber]
    if (manual === 1 || manual === 2) {
      portController.set(chain.portNumber, manual)
    } else {
      portController.set(
        chain.portNumber,
        inferControllerForPort(chain, stripWidths, stripControllerIds),
      )
    }
  }

  const localCounters = new Map<number, number>()
  const meta = new Map<
    number,
    { controllerId: number; localNumber: number; displayId: string }
  >()

  for (const chain of [...mains].sort((a, b) => a.portNumber - b.portNumber)) {
    const controllerId = portController.get(chain.portNumber) ?? 1
    const localNumber = (localCounters.get(controllerId) ?? 0) + 1
    localCounters.set(controllerId, localNumber)
    meta.set(chain.portNumber, {
      controllerId,
      localNumber,
      displayId: `${controllerId}-${localNumber}`,
    })
  }

  return chains.map((chain) => {
    if (chain.isBackup) {
      const mainPort = chain.backupForPort ?? chain.portNumber
      const m = meta.get(mainPort)
      if (!m) return chain
      return {
        ...chain,
        controllerId: m.controllerId,
        localNumber: m.localNumber,
        displayId: `${m.displayId}b`,
      }
    }
    const m = meta.get(chain.portNumber)
    return m ? { ...chain, ...m } : chain
  })
}

/** Перенумерация data-порта: перенести ручной VX */
export function remapDataPortControllers(
  controllers: Record<number, number> | undefined,
  from: number,
  to: number,
  swapped: boolean,
): Record<number, number> | undefined {
  if (!controllers || Object.keys(controllers).length === 0) return controllers
  const next = { ...controllers }
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

/** Подписи D1-1 / D2-3 для ручной схемы (в т.ч. пустые линии с ручным VX) */
export function previewDualVxLineLabels(
  chains: DataChain[],
  manualControllers: Record<number, number> | undefined,
  prefix = 'D',
): Map<number, string> {
  const mains = chains.filter((c) => !c.isBackup)
  const allPorts = new Set<number>()
  for (const c of mains) allPorts.add(c.portNumber)
  for (const p of Object.keys(manualControllers ?? {})) {
    allPorts.add(Number(p))
  }

  const portController = new Map<number, number>()
  for (const chain of mains) {
    const manual = manualControllers?.[chain.portNumber]
    if (manual === 1 || manual === 2) {
      portController.set(chain.portNumber, manual)
    } else if (chain.controllerId === 1 || chain.controllerId === 2) {
      portController.set(chain.portNumber, chain.controllerId)
    } else {
      portController.set(chain.portNumber, 1)
    }
  }
  for (const [p, c] of Object.entries(manualControllers ?? {})) {
    const port = Number(p)
    if (c === 1 || c === 2) portController.set(port, c)
  }

  const localCounters = new Map<number, number>()
  const labels = new Map<number, string>()
  for (const port of [...allPorts].sort((a, b) => a - b)) {
    const cid = portController.get(port) ?? 1
    const local = (localCounters.get(cid) ?? 0) + 1
    localCounters.set(cid, local)
    labels.set(port, `${prefix}${cid}-${local}`)
  }
  return labels
}

/** Следующий локальный номер линии на контроллере (для «+ New D2-4») */
export function nextDualVxLocalNumber(
  controllerId: number,
  chains: DataChain[],
  manualControllers: Record<number, number> | undefined,
  prefix = 'D',
): number {
  let max = 0
  for (const label of previewDualVxLineLabels(chains, manualControllers, prefix).values()) {
    const m = new RegExp(`^${prefix}${controllerId}-(\\d+)$`).exec(label)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max + 1
}
