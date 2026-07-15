import type { CableScheduleEntry, ControllerModel, PackingListItem, RoutingResult, ScreenConfig } from '../types'

/** Ключи строк, для которых количество можно вывести из маршрутизации */
export type EquipmentAutoKey =
  | 'screenSummary'
  | 'ledCard'
  | 'cvtOptical'
  | 'dataCables'
  | 'speakons'
  | 'powerTrunks'
  | 'sprayers'
  | 'hangers'
  | 'hangStraps'
  | 'robot32a'

/** Модель оптического конвертера CVT */
export type CvtModel = 'CVT10' | 'CVT16'

export interface EquipmentListRowTemplate {
  id: string
  hebrew: string
  russian: string
  /** Если задан — количество подставляется из расчёта маршрутизации */
  autoKey?: EquipmentAutoKey
  /** Количество כמויות по умолчанию (если нет autoKey и пользователь не редактировал) */
  defaultQuantity?: string
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
  { id: 'sprays', hebrew: 'שפרייצים', russian: 'Шпрайцы', autoKey: 'sprayers' },
  { id: 'hangers', hebrew: 'תלייה', russian: 'Подвес', autoKey: 'hangers' },
  {
    id: 'rigging-wire',
    hebrew: 'רצועות תלייה',
    russian: 'Тросы для подвеса',
    autoKey: 'hangStraps',
  },
  { id: 'computer', hebrew: 'מחשב', russian: 'Компьютер' },
  /** Процессор по умолчанию не нужен — без autoKey, количество пустое */
  { id: 'processor', hebrew: 'פרוצסור', russian: 'Процессор' },
  { id: 'led-card', hebrew: 'כרטיס לד', russian: 'Картис Лед', autoKey: 'ledCard' },
  {
    id: 'comm-cable',
    hebrew: 'קבל תקשורת',
    russian: 'Тикшорет (сетевой кабель)',
    autoKey: 'dataCables',
  },
  { id: 'speakon', hebrew: 'ספיקונים', russian: 'Спикон', autoKey: 'speakons' },
  { id: 'power-ext', hebrew: 'כבל חשמל', russian: 'Удлинитель электрический', autoKey: 'powerTrunks' },
  { id: 'robot-32a', hebrew: 'רובוט', russian: 'Робот 32А', autoKey: 'robot32a' },
  { id: 'three-phase', hebrew: 'תלת פאזי', russian: 'Кабель 32А (трёхфазный)' },
  { id: 'sdi', hebrew: 'כבל SDI', russian: 'Кабель SDI' },
  { id: 'fiber', hebrew: 'כבל אופטי', russian: 'Оптический кабель' },
  {
    id: 'cvt',
    hebrew: 'CVT / ממיר אופטי',
    russian: 'CVT / оптический конвертер',
    autoKey: 'cvtOptical',
  },
  { id: 'tv', hebrew: 'TV', russian: 'ТВ' },
  { id: 'adapters', hebrew: 'הופכים חשמל', russian: 'Переходники: 63→32, 32→16' },
  { id: 'ratchets', hebrew: "רצ'אטים", russian: 'Рачеты' },
  { id: 'tool-bag', hebrew: 'תיק כלים', russian: 'Сумка с инструментами' },
  { id: 'cable-ties', hebrew: 'אזיקונים', russian: 'Азиконим', defaultQuantity: '+' },
  { id: 'gaffa', hebrew: 'גפה', russian: 'Гафа', defaultQuantity: '+' },
  { id: 'screws', hebrew: 'ברגים', russian: 'Шурупы', defaultQuantity: '+' },
  { id: 'drill', hebrew: 'מברגה', russian: 'Шуруповёрт', defaultQuantity: '+' },
  { id: 'stage-deck', hebrew: 'במה', russian: 'Сцены' },
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

/**
 * Результаты маршрутизации для листа оборудования.
 * Для одного экрана `allScreenResults` часто пуст (ленивый хук) — подставляем активный экран.
 */
export function resolveEquipmentScreenResults(
  allScreenResults: { screen: ScreenConfig; result: RoutingResult }[],
  fallback?: { screen: ScreenConfig; result: RoutingResult } | null,
): { screen: ScreenConfig; result: RoutingResult }[] {
  if (allScreenResults.length > 0) return allScreenResults
  if (fallback) return [fallback]
  return []
}

/**
 * Шпрайцы: ceil(ширина в м) + 1 — только экраны без подвеса (hangMount === false).
 */
function sumSprayers(screens: ScreenConfig[]): number {
  return screens
    .filter((screen) => !screen.hangMount)
    .reduce((sum, screen) => sum + Math.ceil(screen.wallWidthM) + 1, 0)
}

/**
 * Подвес (תלייה): 1 м ширины → 1 шт. Только экраны с hangMount.
 * Math.max(1, Math.ceil(wallWidthM)), чтобы не занижать.
 */
function sumHangers(screens: ScreenConfig[]): number {
  return screens
    .filter((screen) => screen.hangMount)
    .reduce((sum, screen) => sum + Math.max(1, Math.ceil(screen.wallWidthM)), 0)
}

/**
 * Тросы (רצועות תלייה): 1.5 × ширина в м, округление вверх.
 * Только экраны с hangMount. Пример: 10м → 15, 7м → 11.
 */
function sumHangStraps(screens: ScreenConfig[]): number {
  return screens
    .filter((screen) => screen.hangMount)
    .reduce((sum, screen) => sum + Math.ceil(screen.wallWidthM * 1.5), 0)
}

/**
 * Соответствие модели контроллера строке כרטיס לד.
 * В описании — то же имя, что в Sidebar (Controller Model).
 */
export const LED_CARD_BY_CONTROLLER: Record<ControllerModel, string> = {
  TB60: 'TB60',
  'NovaStar VX1000': 'NovaStar VX1000',
  'NovaStar VX2000': 'NovaStar VX2000',
  'NovaStar 600': 'NovaStar 600',
  'NovaStar H2': 'NovaStar H2',
  'NovaStar MCTRL4K': 'NovaStar MCTRL4K',
  Linsn: 'Linsn',
  'Generic 1G Controller': 'Generic 1G Controller',
}

/** Агрегирует כרטיס לד по экранам: 1 карта на экран, имя = controllerModel */
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

/**
 * Количество CVT на один экран:
 * - dataPortCount > 6 → 2
 * - иначе trunkLengthM > 30 → 1
 * - иначе 0
 */
export function resolveCvtQtyForScreen(trunkLengthM: number, dataPortCount: number): number {
  if (dataPortCount > 6) return 2
  if (trunkLengthM > 30) return 1
  return 0
}

/** MCTRL4K → CVT16, остальные контроллеры → CVT10 */
export function resolveCvtModel(controllerModel: ControllerModel): CvtModel {
  return controllerModel === 'NovaStar MCTRL4K' ? 'CVT16' : 'CVT10'
}

/**
 * Агрегирует CVT по экранам (модель + количество).
 * При смешанных моделях: описание «CVT10 ×N; CVT16 ×M», quantity = сумма.
 */
export function aggregateCvtOptical(
  results: { screen: ScreenConfig; result: RoutingResult }[],
): { quantity: number; russian: string } {
  const byModel = new Map<CvtModel, number>()

  for (const { screen, result } of results) {
    const qty = resolveCvtQtyForScreen(screen.trunkLengthM, result.summary.dataPorts)
    if (qty <= 0) continue
    const model = resolveCvtModel(screen.controllerModel)
    byModel.set(model, (byModel.get(model) ?? 0) + qty)
  }

  if (byModel.size === 0) {
    return { quantity: 0, russian: 'CVT / оптический конвертер' }
  }

  const totalQty = [...byModel.values()].reduce((sum, n) => sum + n, 0)
  const russian =
    byModel.size === 1
      ? [...byModel.keys()][0]
      : [...byModel.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, qty]) => `${name} ×${qty}`)
          .join('; ')

  return { quantity: totalQty, russian }
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
  _packingList?: PackingListItem[],
): string | number | undefined {
  switch (key) {
    case 'screenSummary':
      return results.length > 0 ? buildScreenSummary(results) : undefined
    case 'ledCard':
      return screens.length > 0 ? screens.length : undefined
    case 'cvtOptical': {
      const cvt = aggregateCvtOptical(results)
      return cvt.quantity > 0 ? cvt.quantity : undefined
    }
    case 'dataCables':
      return countDataTrunkAndLinkCables(cableSchedule)
    case 'speakons': {
      const powerLines = sumPowerLines(results)
      return powerLines > 0 ? powerLines : undefined
    }
    case 'powerTrunks':
      return countTrunks(cableSchedule, 'Power')
    case 'sprayers': {
      if (screens.length === 0) return undefined
      const qty = sumSprayers(screens)
      return qty > 0 ? qty : 0
    }
    case 'hangers': {
      if (screens.length === 0) return undefined
      const qty = sumHangers(screens)
      return qty > 0 ? qty : 0
    }
    case 'hangStraps': {
      if (screens.length === 0) return undefined
      const qty = sumHangStraps(screens)
      return qty > 0 ? qty : 0
    }
    case 'robot32a': {
      const powerLines = sumPowerLines(results)
      return results.length > 0 ? Math.max(1, Math.ceil(powerLines / 6)) : undefined
    }
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
    const cvtAuto = template.id === 'cvt' ? aggregateCvtOptical(results) : undefined
    const autoRussian = ledCardAuto?.russian ?? cvtAuto?.russian

    return {
      ...template,
      russian: autoRussian ?? template.russian,
      quantity:
        quantityManual && previous
          ? previous.quantity
          : formatQty(autoQty ?? template.defaultQuantity),
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
