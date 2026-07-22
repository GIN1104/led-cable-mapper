import type { BackupPortMode, DataChain } from '../types'

/** ≤5 линий: backup на следующих свободных номерах; 6–10: пара CVT10 Main/Backup */
export type BackupNumberingLayout = 'offset' | 'paired'

export interface PortDisplayAssignment {
  layout: BackupNumberingLayout
  /** Внутренний portNumber → номер на схеме (Main) */
  mainDisplayByPort: Record<number, number>
  /** Внутренний main portNumber → номер Backup на схеме */
  backupDisplayByPort: Record<number, number>
}

function sortedMainPorts(chains: DataChain[]): number[] {
  const ports = new Set<number>()
  for (const c of chains) {
    if (c.isBackup || c.cabinets.length === 0) continue
    ports.add(c.portNumber)
  }
  return [...ports].sort((a, b) => a - b)
}

/** Авто: backup с ближайших незанятых номеров (для ≤5) */
function autoOffsetBackup(mainPorts: number[]): Record<number, number> {
  const used = new Set(mainPorts)
  const out: Record<number, number> = {}
  let candidate = 1
  for (const port of mainPorts) {
    while (used.has(candidate)) candidate++
    out[port] = candidate
    used.add(candidate)
    candidate++
  }
  return out
}

/** Авто: backup = тот же номер (CVT10 Backup соответствует Main) */
function autoPairedBackup(mainPorts: number[]): Record<number, number> {
  const out: Record<number, number> = {}
  for (const port of mainPorts) out[port] = port
  return out
}

function clampDisplayNum(n: number): number {
  return Math.max(1, Math.min(99, Math.floor(n) || 1))
}

/**
 * Считает нумерацию Main/Backup для легенды и схемы.
 * dual VX (displayId вида 1-1) не перезаписываем — только числовой режим.
 */
export function resolvePortDisplayAssignment(
  mainChains: DataChain[],
  options: {
    backupPortMode?: BackupPortMode
    mainPortDisplayNumbers?: Record<number, number>
    backupPortDisplayNumbers?: Record<number, number>
  },
): PortDisplayAssignment {
  const mainPorts = sortedMainPorts(mainChains)
  const count = mainPorts.length
  const layout: BackupNumberingLayout = count >= 6 ? 'paired' : 'offset'

  const mainDisplayByPort: Record<number, number> = {}
  for (const port of mainPorts) {
    mainDisplayByPort[port] = port
  }

  let backupDisplayByPort: Record<number, number> =
    layout === 'paired' ? autoPairedBackup(mainPorts) : autoOffsetBackup(mainPorts)

  if (options.backupPortMode === 'manual') {
    const manMain = options.mainPortDisplayNumbers ?? {}
    const manBackup = options.backupPortDisplayNumbers ?? {}
    for (const port of mainPorts) {
      if (manMain[port] != null) {
        mainDisplayByPort[port] = clampDisplayNum(manMain[port]!)
      }
      if (manBackup[port] != null) {
        backupDisplayByPort[port] = clampDisplayNum(manBackup[port]!)
      }
    }
  }

  return { layout, mainDisplayByPort, backupDisplayByPort }
}

/** Нужно ли показывать заголовки CVT10 Main / Backup */
export function shouldShowCvt10Headers(
  assignment: PortDisplayAssignment,
  dualVx1000: boolean,
): boolean {
  return (
    !dualVx1000 &&
    assignment.layout === 'paired' &&
    Object.keys(assignment.mainDisplayByPort).length >= 6
  )
}

/** Применяет числовые displayId к основным цепочкам (не трогает dual «1-1») */
export function applyMainPortDisplayIds(
  chains: DataChain[],
  assignment: PortDisplayAssignment,
  dualVx1000: boolean,
): DataChain[] {
  if (dualVx1000) return chains
  return chains.map((c) => {
    if (c.isBackup) return c
    const n = assignment.mainDisplayByPort[c.portNumber]
    if (n == null) return c
    return { ...c, displayId: String(n) }
  })
}

/** Проставляет номера backup по assignment (portNumber остаётся = main для связки) */
export function applyBackupPortDisplayIds(
  backupChains: DataChain[],
  assignment: PortDisplayAssignment,
  dualVx1000: boolean,
): DataChain[] {
  return backupChains.map((c) => {
    const mainPort = c.backupForPort ?? c.portNumber
    const n = assignment.backupDisplayByPort[mainPort]
    if (n == null) return c
    if (dualVx1000 && c.displayId?.includes('-')) {
      return c
    }
    return {
      ...c,
      displayId: String(n),
    }
  })
}

/** Подпись линии Main для легенды */
export function formatMainLegendId(
  port: number,
  assignment: PortDisplayAssignment,
  chainDisplayId?: string,
  dualVx1000?: boolean,
): string {
  if (dualVx1000 && chainDisplayId) return chainDisplayId.replace(/b$/i, '')
  const n = assignment.mainDisplayByPort[port]
  return n != null ? String(n) : String(port)
}

/** Подпись линии Backup для легенды */
export function formatBackupLegendId(
  mainPort: number,
  assignment: PortDisplayAssignment,
  chainDisplayId?: string,
  dualVx1000?: boolean,
): string {
  if (dualVx1000 && chainDisplayId) return chainDisplayId
  const n = assignment.backupDisplayByPort[mainPort]
  return n != null ? String(n) : `${mainPort}b`
}
