import type { CableScheduleEntry, ControllerModel, PackingListItem, RoutingResult, ScreenConfig } from '../types'

/** Ключи строк, для которых количество можно вывести из маршрутизации */
export type EquipmentAutoKey =
  | 'screenSummary'
  | 'controllers'
  | 'ledCard'
  | 'dataCables'
  | 'powerTrunks'
  | 'robot32a'
  | 'cableTies'

export interface EquipmentListRowTemplate {
  id: string
  hebrew: string
  russian: string
  /** Если задан — количество подставляется из расчёта маршрутизации */
  autoKey?: EquipmentAutoKey
  /** Значение תופסות по умолчанию (если пользователь не редактировал) */
  defaultFootprint?: string
}

export interface EquipmentListRow extends EquipmentListRowTemplate {
  quantity: string
  footprint: string
  /** Пользователь вручную изменил quantity — не перезаписывать при обновлении */
  quantityManual: boolean
  footprintManual: boolean
}

export interface EquipmentListMeta {
  eventDate: string
  eventName: string
  location: string
  hours: string
  contact: string
}

/** Строка, добавленная пользователем в конец списка (не из шаблона) */
export interface EquipmentCustomRow {
  id: string
  hebrew: string
  russian: string
  quantity: string
  footprint: string
}

export interface EquipmentListState {
  meta: EquipmentListMeta
  rows: EquipmentListRow[]
  /** Пользовательские строки в конце списка — сохраняются при пересчёте маршрутизации */
  customRows: EquipmentCustomRow[]
}

/** Шаблон листа «לדים» из Excel */
export const LED_EQUIPMENT_TEMPLATE: EquipmentListRowTemplate[] = [
  { id: 'screen', hebrew: 'מסך', russian: 'Экран', autoKey: 'screenSummary' },
  { id: 'sprays', hebrew: 'שפרייצים', russian: 'Шпрайцы' },
  { id: 'computer', hebrew: 'מחשב', russian: 'Компьютер' },
  { id: 'processor', hebrew: 'פרוצסור', russian: 'Процессор', autoKey: 'controllers' },
  { id: 'led-card', hebrew: 'כרטיס לד', russian: 'Картис Лед', autoKey: 'ledCard' },
  {
    id: 'comm-cable',
    hebrew: 'קבל תקשורת',
    russian: 'Тикшорет (сетевой кабель)',
    autoKey: 'dataCables',
    defaultFootprint: 'A',
  },
  { id: 'speakon', hebrew: 'ספיקונים', russian: 'Спикон' },
  { id: 'power-ext', hebrew: 'כבל חשמל', russian: 'Удлинитель электрический', autoKey: 'powerTrunks' },
  { id: 'robot-32a', hebrew: 'רובוט', russian: 'Робот 32А', autoKey: 'robot32a' },
  { id: 'three-phase', hebrew: 'תלת פאזי', russian: 'Кабель 32А (трёхфазный)' },
  { id: 'sdi', hebrew: 'כבל SDI', russian: 'Кабель SDI' },
  { id: 'fiber', hebrew: 'כבל אופטי', russian: 'Оптический кабель' },
  { id: 'tv', hebrew: 'TV', russian: 'ТВ' },
  { id: 'adapters', hebrew: 'הופכים חשמל', russian: 'Переходники: 63→32, 32→16' },
  { id: 'rigging-wire', hebrew: 'רצועות תלייה (wire)', russian: 'Тросы для подвеса + подвес' },
  { id: 'ratchets', hebrew: "רצ'אטים", russian: 'Рачеты' },
  { id: 'tool-bag', hebrew: 'תיק כלים', russian: 'Сумка с инструментами' },
  { id: 'cable-ties', hebrew: 'אזיקונים', russian: 'Азиконим', autoKey: 'cableTies' },
  { id: 'gaffa', hebrew: 'גפה', russian: 'Гафа' },
  { id: 'screws', hebrew: 'ברגים', russian: 'Шурупы' },
  { id: 'stage-deck', hebrew: 'במה', russian: 'Сцены' },
  { id: 'drill', hebrew: 'מברגה', russian: 'Шуруповёрт' },
  { id: 'truss', hebrew: 'טראנס', russian: 'Ферма (трас)' },
]

export const EMPTY_EQUIPMENT_META: EquipmentListMeta = {
  eventDate: '',
  eventName: '',
  location: '',
  hours: '',
  contact: '',
}

/** Создаёт пустую пользовательскую строку с уникальным id */
export function createEmptyCustomRow(): EquipmentCustomRow {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? `custom-${crypto.randomUUID()}`
      : `custom-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  return { id, hebrew: '', russian: '', quantity: '', footprint: '' }
}

/** Все строки для отображения и экспорта: шаблон + пользовательские */
export function getEquipmentListExportRows(
  state: EquipmentListState,
): { hebrew: string; russian: string; quantity: string; footprint: string }[] {
  return [
    ...state.rows.map((row) => ({
      hebrew: row.hebrew,
      russian: row.russian,
      quantity: row.quantity,
      footprint: row.footprint,
    })),
    ...state.customRows,
  ]
}

/** Кабинетов в кейсе: 500×500 → 8, 500×1000 → 6 */
export function cabinetsPerCase(cabinetWidthMm: number, cabinetHeightMm: number): number {
  if (cabinetWidthMm === 500 && cabinetHeightMm === 500) return 8
  if (cabinetWidthMm === 500 && cabinetHeightMm === 1000) return 6
  return cabinetHeightMm >= 1000 ? 6 : 8
}

function formatMeters(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function countTrunks(
  schedule: CableScheduleEntry[],
  lineType: CableScheduleEntry['lineType'],
): number {
  return schedule.filter((e) => e.lineType === lineType && e.cableId.startsWith('M-')).length
}

function countDataLinkCables(schedule: CableScheduleEntry[]): number {
  return schedule.filter(
    (e) =>
      (e.lineType === 'Data' || e.lineType === 'Data Backup') &&
      (e.cableId.startsWith('L-DAT-') || e.cableId.startsWith('L-DBK-')),
  ).length
}

function countDataTrunkAndLinkCables(schedule: CableScheduleEntry[]): number {
  const dataTrunks = countTrunks(schedule, 'Data')
  const backupTrunks = countTrunks(schedule, 'Data Backup')
  const links = countDataLinkCables(schedule)
  return dataTrunks + backupTrunks + links
}

function sumPowerLines(results: { result: RoutingResult }[]): number {
  return results.reduce((sum, { result }) => sum + result.summary.powerLines, 0)
}

function findPackingQty(items: PackingListItem[], needle: string): number | undefined {
  const item = items.find((row) => row.item.toLowerCase().includes(needle.toLowerCase()))
  return item?.quantity
}

/**
 * Соответствие модели контроллера типу output-карты (כרטיס לד).
 * Количество по умолчанию: 1 карта на активный экран (как процессор).
 */
export const LED_CARD_BY_CONTROLLER: Record<ControllerModel, string> = {
  TB60: 'TB60 output card',
  'NovaStar VX1000': 'NovaStar VX output card',
  'NovaStar VX2000': 'NovaStar VX2000 output card',
  'NovaStar 600': 'MCTRL600 output card',
  'NovaStar H2': 'NovaStar H2 output card',
  'NovaStar MCTRL4K': 'NovaStar 4K output card',
  Linsn: 'Linsn sending card',
  'Generic 1G Controller': 'Generic output card',
}

/** Агрегирует כרטיס לד по экранам: количество и описание типа карты */
export function aggregateLedCards(screens: ScreenConfig[]): {
  quantity: number
  russian: string
} {
  if (screens.length === 0) {
    return { quantity: 0, russian: 'Картис Лед' }
  }

  const byCard = new Map<string, number>()
  for (const screen of screens) {
    const cardName = LED_CARD_BY_CONTROLLER[screen.controllerModel]
    byCard.set(cardName, (byCard.get(cardName) ?? 0) + 1)
  }

  const russian =
    byCard.size === 1
      ? [...byCard.keys()][0]
      : [...byCard.entries()].map(([name, qty]) => `${name} ×${qty}`).join('; ')

  return { quantity: screens.length, russian }
}

/** Описание экрана: «Screen 1: 10×3m (60 cab, 10 cases)» */
export function buildScreenSummaryLine(
  screen: ScreenConfig,
  activeCabinets: number,
): string {
  const perCase = cabinetsPerCase(screen.cabinetWidthMm, screen.cabinetHeightMm)
  const cases = Math.ceil(activeCabinets / perCase)
  const w = formatMeters(screen.wallWidthM)
  const h = formatMeters(screen.wallHeightM)
  return `${screen.name}: ${w}×${h}m (${activeCabinets} cab, ${cases} cases)`
}

export function buildScreenSummary(
  results: { screen: ScreenConfig; result: RoutingResult }[],
): string {
  return results
    .map(({ screen, result }) =>
      buildScreenSummaryLine(screen, result.summary.totalCabinets),
    )
    .join('\n')
}

/** Вычисляет авто-значения количества по ключу */
export function resolveEquipmentAutoQuantity(
  key: EquipmentAutoKey,
  screens: ScreenConfig[],
  results: { screen: ScreenConfig; result: RoutingResult }[],
  cableSchedule: CableScheduleEntry[],
  packingList: PackingListItem[],
): string | number | undefined {
  switch (key) {
    case 'screenSummary':
      return results.length > 0 ? buildScreenSummary(results) : undefined
    case 'controllers':
      return screens.length
    case 'ledCard':
      return screens.length > 0 ? screens.length : undefined
    case 'dataCables':
      return countDataTrunkAndLinkCables(cableSchedule)
    case 'powerTrunks':
      return countTrunks(cableSchedule, 'Power')
    case 'robot32a': {
      const powerLines = sumPowerLines(results)
      return powerLines > 0 ? Math.ceil(powerLines / 6) : undefined
    }
    case 'cableTies':
      return findPackingQty(packingList, 'Cable Ties')
    default:
      return undefined
  }
}

function formatQty(value: string | number | undefined): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  return value === 0 ? '' : String(value)
}

/** Создаёт начальное состояние таблицы с автозаполнением */
export function buildEquipmentListState(
  screens: ScreenConfig[],
  results: { screen: ScreenConfig; result: RoutingResult }[],
  cableSchedule: CableScheduleEntry[],
  packingList: PackingListItem[],
  prev?: EquipmentListState,
): EquipmentListState {
  const prevById = new Map(prev?.rows.map((row) => [row.id, row]) ?? [])

  const rows: EquipmentListRow[] = LED_EQUIPMENT_TEMPLATE.map((template) => {
    const previous = prevById.get(template.id)
    const autoQty =
      template.autoKey != null
        ? resolveEquipmentAutoQuantity(
            template.autoKey,
            screens,
            results,
            cableSchedule,
            packingList,
          )
        : undefined

    const quantityManual = previous?.quantityManual ?? false
    const footprintManual = previous?.footprintManual ?? false
    const ledCardAuto = template.id === 'led-card' ? aggregateLedCards(screens) : undefined

    return {
      ...template,
      russian: ledCardAuto?.russian ?? template.russian,
      quantity:
        quantityManual && previous
          ? previous.quantity
          : formatQty(autoQty),
      footprint:
        footprintManual && previous
          ? previous.footprint
          : (template.defaultFootprint ?? previous?.footprint ?? ''),
      quantityManual,
      footprintManual,
    }
  })

  return {
    meta: prev?.meta ?? { ...EMPTY_EQUIPMENT_META },
    rows,
    customRows: prev?.customRows ?? [],
  }
}

/** Экспорт в CSV (UTF-8 с BOM для Excel) */
export function equipmentListToCsv(state: EquipmentListState): string {
  const lines: string[] = [
    `תאריך,${state.meta.eventDate}`,
    `שם האירוע,${state.meta.eventName}`,
    '',
    'ציוד,Оборудование,כמויות,תופסות',
  ]

  for (const row of getEquipmentListExportRows(state)) {
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`
    lines.push(
      [row.hebrew, row.russian, row.quantity, row.footprint].map(escape).join(','),
    )
  }

  lines.push(
    '',
    `מיקום:,${state.meta.location}`,
    `שעות:,${state.meta.hours}`,
    `איש קשר:,${state.meta.contact}`,
  )

  return `\uFEFF${lines.join('\r\n')}`
}

/** Имя файла: equipment-list-{событие или дата}.xlsx */
export function getEquipmentListXlsxFilename(meta: EquipmentListMeta): string {
  const sanitize = (value: string) =>
    value
      .trim()
      .replace(/[<>:"/\\|?*]+/g, '-')
      .replace(/\s+/g, '-')
      .slice(0, 80)

  const eventPart = sanitize(meta.eventName)
  const datePart = sanitize(meta.eventDate) || new Date().toISOString().slice(0, 10)
  return `equipment-list-${eventPart || datePart}.xlsx`
}

/** Скачать .xlsx в браузере */
export async function downloadEquipmentListXlsx(state: EquipmentListState): Promise<void> {
  const blob = await equipmentListToXlsxBlob(state)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = getEquipmentListXlsxFilename(state.meta)
  anchor.click()
  URL.revokeObjectURL(url)
}

/** Экспорт в .xlsx (лист «לדים») */
export async function equipmentListToXlsxBlob(state: EquipmentListState): Promise<Blob> {
  const XLSX = await import('xlsx')

  const sheetData: (string | number)[][] = [
    ['תאריך', state.meta.eventDate],
    ['שם האירוע', state.meta.eventName],
    [],
    ['ציוד', 'Оборудование', 'כמויות', 'תופסות'],
    ...getEquipmentListExportRows(state).map((row) => [
      row.hebrew,
      row.russian,
      row.quantity,
      row.footprint,
    ]),
    [],
    ['מיקום:', state.meta.location],
    ['שעות:', state.meta.hours],
    ['איש קשר:', state.meta.contact],
  ]

  const worksheet = XLSX.utils.aoa_to_sheet(sheetData)
  worksheet['!cols'] = [{ wch: 22 }, { wch: 28 }, { wch: 36 }, { wch: 12 }]

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'לדים')

  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}
