import type {
  CableScheduleEntry,
  DataChain,
  PowerLine,
  ScreenConfig,
} from '../types'
import {
  CABLE_TYPES,
  COLOR_ADVICE,
  LINK_CABLE_HORIZONTAL_M,
  LINK_CABLE_VERTICAL_M,
  MAX_POWER_LINK_LENGTH_M,
} from './constants'
import { linkLengthBetween, powerLinkLengthBetween } from './cabinetGrid'
import { getPowerTrunkCabinet, getPowerTrunkSourceLabel } from './powerRouting'

function padId(num: number): string {
  return String(num).padStart(2, '0')
}

/** Генерирует текстовую схему маршрутизации для монтажной бригады */
export function buildRoutingSchema(
  config: ScreenConfig,
  dataChains: DataChain[],
  backupChains: DataChain[],
  powerLines: PowerLine[],
  screenName?: string,
): string[] {
  const lines: string[] = []
  const trunk = `${config.trunkLengthM}m Trunk`
  const controller = config.controllerModel
  const prefix = screenName ? `[${screenName}] ` : ''

  lines.push(`${prefix}=== DATA ROUTING ===`)
  for (const chain of dataChains) {
    const path = chain.cabinets.map((c) => c.label).join(' → ')
    lines.push(
      `DATA PORT ${chain.portNumber}: ${controller} → ${trunk} → ${path}`,
    )
  }

  if (config.signalBackup && backupChains.length > 0) {
    lines.push('')
    lines.push('=== DATA BACKUP (V-BACKUP) ===')
    for (const chain of backupChains) {
      const path = chain.cabinets.map((c) => c.label).join(' → ')
      lines.push(
        `BACKUP PORT ${chain.portNumber}: ${controller} (backup out) → ${trunk} → ${path}`,
      )
    }
  }

  lines.push('')
  lines.push('=== POWER ROUTING ===')
  const feedModeLabel =
    config.powerFeedMode === 'center' ? 'center feed per band' : 'edge feed (line start)'
  if (powerLines.length > 0) {
    lines.push(
      `Feed mode: ${feedModeLabel} · ${getPowerTrunkSourceLabel(config.powerFeedMode)}`,
    )
  }
  for (const line of powerLines) {
    const path = line.cabinets.map((c) => c.label).join(' → ')
    const chainStart = line.cabinets[0]?.label ?? '?'
    const feedCab = getPowerTrunkCabinet(line, config.powerFeedMode)
    if (config.powerFeedMode === 'center') {
      lines.push(
        `POWER LINE ${line.lineNumber}: ${getPowerTrunkSourceLabel(config.powerFeedMode)} → ${trunk} → ${feedCab.label} (center feed) · chain start ★ ${chainStart}: ${path} (${line.totalPowerW}W max)`,
      )
    } else {
      lines.push(
        `POWER LINE ${line.lineNumber}: ${getPowerTrunkSourceLabel(config.powerFeedMode)} → ${trunk} → ${feedCab.label} (edge feed = chain start) · chain ${path} (${line.totalPowerW}W max)`,
      )
    }
  }

  return lines
}

/** Генерирует кабельную ведомость */
export function buildCableSchedule(
  config: ScreenConfig,
  dataChains: DataChain[],
  backupChains: DataChain[],
  powerLines: PowerLine[],
  screenName?: string,
): CableScheduleEntry[] {
  const entries: CableScheduleEntry[] = []
  const screenPrefix = screenName ? `${screenName} — ` : ''
  let dataTrunkCount = 0
  let dataLinkCount = 0
  let backupTrunkCount = 0
  let backupLinkCount = 0
  let powerTrunkCount = 0
  let powerLinkCount = 0

  const trunkLen = config.trunkLengthM

  for (const chain of dataChains) {
    dataTrunkCount++
    const first = chain.cabinets[0]
    entries.push({
      cableId: `M-DAT-${padId(dataTrunkCount)}`,
      lineType: 'Data',
      source: `${screenPrefix}${config.controllerModel}`,
      destination: `${screenPrefix}Cabinet ${first.label}`,
      cableType: CABLE_TYPES.dataTrunk,
      lengthM: trunkLen,
      quantity: 1,
      colorAdvice: COLOR_ADVICE.data,
    })

    for (let i = 0; i < chain.cabinets.length - 1; i++) {
      dataLinkCount++
      const from = chain.cabinets[i]
      const to = chain.cabinets[i + 1]
      const len =
        from.row === to.row ? LINK_CABLE_HORIZONTAL_M : LINK_CABLE_VERTICAL_M
      entries.push({
        cableId: `L-DAT-${padId(dataLinkCount)}`,
        lineType: 'Data',
        source: `${screenPrefix}Cabinet ${from.label}`,
        destination: `${screenPrefix}Cabinet ${to.label}`,
        cableType: CABLE_TYPES.dataLink,
        lengthM: len,
        quantity: 1,
        colorAdvice: COLOR_ADVICE.data,
      })
    }
  }

  if (config.signalBackup) {
    for (const chain of backupChains) {
      backupTrunkCount++
      const first = chain.cabinets[0]
      entries.push({
        cableId: `M-DBK-${padId(backupTrunkCount)}`,
        lineType: 'Data Backup',
        source: `${screenPrefix}${config.controllerModel} (backup)`,
        destination: `${screenPrefix}Cabinet ${first.label}`,
        cableType: CABLE_TYPES.dataBackupTrunk,
        lengthM: trunkLen,
        quantity: 1,
        colorAdvice: COLOR_ADVICE.dataBackup,
      })

      for (let i = 0; i < chain.cabinets.length - 1; i++) {
        backupLinkCount++
        const from = chain.cabinets[i]
        const to = chain.cabinets[i + 1]
        const len = linkLengthBetween(from, to)
        entries.push({
          cableId: `L-DBK-${padId(backupLinkCount)}`,
          lineType: 'Data Backup',
          source: `${screenPrefix}Cabinet ${from.label}`,
          destination: `${screenPrefix}Cabinet ${to.label}`,
          cableType: CABLE_TYPES.dataBackupLink,
          lengthM: len,
          quantity: 1,
          colorAdvice: COLOR_ADVICE.dataBackup,
        })
      }
    }
  }

  const powerTrunkSource = `${screenPrefix}${getPowerTrunkSourceLabel(config.powerFeedMode)}`

  for (const line of powerLines) {
    powerTrunkCount++
    const feedCab = getPowerTrunkCabinet(line, config.powerFeedMode)
    const trunkColorAdvice =
      config.powerFeedMode === 'center'
        ? `${COLOR_ADVICE.power}; center feed trunk → ${feedCab.label}`
        : `${COLOR_ADVICE.power}; edge feed trunk (chain start ${feedCab.label})`
    entries.push({
      cableId: `M-PWR-${padId(powerTrunkCount)}`,
      lineType: 'Power',
      source: powerTrunkSource,
      destination: `${screenPrefix}Cabinet ${feedCab.label}`,
      cableType: CABLE_TYPES.powerTrunk,
      lengthM: trunkLen,
      quantity: 1,
      colorAdvice: trunkColorAdvice,
    })

    for (let i = 0; i < line.cabinets.length - 1; i++) {
      powerLinkCount++
      const from = line.cabinets[i]
      const to = line.cabinets[i + 1]
      const len = powerLinkLengthBetween(
        from,
        to,
        config.cabinetWidthMm,
        config.cabinetHeightMm,
      )
      const cappedLen = Math.min(len, MAX_POWER_LINK_LENGTH_M)
      entries.push({
        cableId: `L-PWR-${padId(powerLinkCount)}`,
        lineType: 'Power',
        source: `${screenPrefix}Cabinet ${from.label}`,
        destination: `${screenPrefix}Cabinet ${to.label}`,
        cableType: CABLE_TYPES.powerLink,
        lengthM: cappedLen,
        quantity: 1,
        colorAdvice: COLOR_ADVICE.power,
      })
    }
  }

  return entries
}
