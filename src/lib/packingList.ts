import type { CableScheduleEntry, PackingListItem, ScreenConfig } from '../types'
import { SPARE_CABLE_FACTOR } from './constants'

function withSpare(count: number): number {
  return Math.ceil(count * SPARE_CABLE_FACTOR)
}

/** Объединяет упаковочные листы нескольких экранов */
export function mergePackingLists(lists: PackingListItem[][]): PackingListItem[] {
  const merged = new Map<string, PackingListItem>()

  for (const list of lists) {
    for (const item of list) {
      const key = item.item
      const existing = merged.get(key)
      if (existing) {
        merged.set(key, {
          ...existing,
          quantity: existing.quantity + item.quantity,
          notes: existing.notes === item.notes ? existing.notes : `${existing.notes}; ${item.notes}`,
        })
      } else {
        merged.set(key, { ...item })
      }
    }
  }

  return [...merged.values()]
}

/** Генерирует упаковочный лист с запасом +10% */
export function buildPackingList(
  config: ScreenConfig,
  cableSchedule: CableScheduleEntry[],
  activeCabinetCount?: number,
): PackingListItem[] {
  const totalCabinets =
    activeCabinetCount ??
    config.cabinetsWide * config.cabinetsHigh - config.emptyCabinets.length

  const dataTrunks = cableSchedule.filter(
    (e) => e.lineType === 'Data' && e.cableId.startsWith('M-'),
  ).length
  const dataLinks = cableSchedule.filter(
    (e) => e.lineType === 'Data' && e.cableId.startsWith('L-'),
  ).length
  const backupTrunks = cableSchedule.filter(
    (e) => e.lineType === 'Data Backup' && e.cableId.startsWith('M-'),
  ).length
  const backupLinks = cableSchedule.filter(
    (e) => e.lineType === 'Data Backup' && e.cableId.startsWith('L-'),
  ).length
  const powerTrunks = cableSchedule.filter(
    (e) => e.lineType === 'Power' && e.cableId.startsWith('M-'),
  ).length
  const powerLinks = cableSchedule.filter(
    (e) => e.lineType === 'Power' && e.cableId.startsWith('L-'),
  ).length

  const items: PackingListItem[] = [
    {
      item: 'LED Cabinets',
      quantity: totalCabinets,
      notes: `${config.cabinetWidthMm}×${config.cabinetHeightMm}mm`,
    },
    {
      item: `Data Trunk Cables (${config.trunkLengthM}m)`,
      quantity: withSpare(dataTrunks),
      notes: 'Cat6 SFTP + EtherCON',
    },
    {
      item: 'Data Link Cables (0.7m / 1.2m mix)',
      quantity: withSpare(dataLinks),
      notes: 'Short EtherCON patch',
    },
  ]

  if (config.signalBackup) {
    items.push(
      {
        item: `Backup Data Trunk Cables (${config.trunkLengthM}m)`,
        quantity: withSpare(backupTrunks),
        notes: 'Green-marked backup trunks',
      },
      {
        item: 'Backup Data Link Cables',
        quantity: withSpare(backupLinks),
        notes: 'Green-marked short links',
      },
    )
  }

  const powerTrunkNotes =
    config.powerFeedMode === 'center' && powerTrunks > 0
      ? `32A PDU distro (center feed), ${powerTrunks} outlet(s); 3×2.5mm² + PowerCON TRUE1`
      : '3×2.5mm² + PowerCON TRUE1'

  items.push(
    {
      item: `Power Trunk Cables (${config.trunkLengthM}m)`,
      quantity: withSpare(powerTrunks),
      notes: powerTrunkNotes,
    },
    {
      item: 'Power Link Cables',
      quantity: withSpare(powerLinks),
      notes: 'Short PowerCON jumpers',
    },
    {
      item: 'Cable Ties / Velcro (assorted)',
      quantity: withSpare(Math.ceil(totalCabinets / 4)),
      notes: 'Color-coded per schedule',
    },
    {
      item: 'Heat-shrink labels (Blue/Green/Red)',
      quantity: 1,
      notes: '1 kit per wall section',
    },
  )

  return items
}

/** Объединяет упаковочные листы нескольких экранов */
export function buildCombinedPackingList(
  perScreenLists: { screenName: string; items: PackingListItem[] }[],
): PackingListItem[] {
  const merged = new Map<string, PackingListItem>()

  for (const { screenName, items } of perScreenLists) {
    for (const item of items) {
      const key = item.item
      const existing = merged.get(key)
      if (existing) {
        merged.set(key, {
          item: key,
          quantity: existing.quantity + item.quantity,
          notes: existing.notes.includes(screenName)
            ? existing.notes
            : `${existing.notes}; ${screenName}: ${item.quantity}`,
        })
      } else {
        merged.set(key, { ...item, notes: `${screenName}: ${item.notes}` })
      }
    }
  }

  return [...merged.values()]
}

