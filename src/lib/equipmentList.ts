import type { CableScheduleEntry, ControllerModel, PackingListItem, RoutingResult, ScreenConfig } from '../types'

/** Ключи строк, для которых количество можно вывести из маршрутизации */
export type EquipmentAutoKey =
  | 'screenSummary'
  | 'ledCard'
  | 'cvtOptical'
  | 'opticCable'
  | 'dataCables'
  | 'commCableLong'
  | 'speakons'
  | 'powerTrunks'
  | 'sprayers'
  | 'hangers'
  | 'hangStraps'
  | 'robot32a'
  | 'cable32a'

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
  /** Пользователь вручную изменил ивритское название — не перезаписывать */
  hebrewManual: boolean
  /** Пользователь вручную изменил русское описание — не перезаписывать авто-текст */
  russianManual: boolean
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
    id: 'cvt',
    hebrew: 'CVT / ממיר אופטי',
    russian: 'CVT / оптический конвертер',
    autoKey: 'cvtOptical',
  },
  {
    id: 'comm-cable',
    hebrew: 'קבל תקשורת',
    russian: 'Тикшорет (сетевой кабель)',
    autoKey: 'dataCables',
  },
  {
    id: 'comm-cable-long',
    hebrew: 'תקשורת תארוך',
    russian: 'Тикшорет Длинный',
    autoKey: 'commCableLong',
  },
  { id: 'speakon', hebrew: 'ספיקונים', russian: 'Спикон', autoKey: 'speakons' },
  { id: 'power-ext', hebrew: 'כבל חשמל', russian: 'Удлинитель электрический', autoKey: 'powerTrunks' },
  { id: 'robot-32a', hebrew: 'רובוט', russian: 'Робот 32А', autoKey: 'robot32a' },
  {
    id: 'three-phase',
    hebrew: 'תלת פאזי',
    russian: 'Кабель 32А (трёхфазный)',
    autoKey: 'cable32a',
  },
  { id: 'sdi', hebrew: 'כבל SDI', russian: 'Кабель SDI' },
  { id: 'fiber', hebrew: 'כבל אופטי', russian: 'Оптический кабель', autoKey: 'opticCable' },
  { id: 'tv', hebrew: 'TV', russian: 'ТВ' },
  { id: 'adapters', hebrew: 'הופכים חשמל', russian: 'Переходники: 63→32, 32→16' },
  { id: 'ratchets', hebrew: "רצ'אטים", russian: 'Рачеты' },
  { id: 'tool-bag', hebrew: 'תיק כלים', russian: 'Сумка с инструментами', defaultQuantity: '+' },
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

/** Кабинетов в кейсе: 500×500 → 8, 500×1000 / 1000×500 → 6 */
export function cabinetsPerCase(cabinetWidthMm: number, cabinetHeightMm: number): number {
  if (cabinetWidthMm === 500 && cabinetHeightMm === 500) return 8
  if (cabinetWidthMm === 500 && cabinetHeightMm === 1000) return 6
  if (cabinetWidthMm === 1000 && cabinetHeightMm === 500) return 6
  return cabinetHeightMm >= 1000 || cabinetWidthMm >= 1000 ? 6 : 8
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

/** Округление вверх до кратного 20 (1→20, 21→40, 40→40, 0→0) */
export function roundUpToNext20(rawQty: number): number {
  if (rawQty <= 0) return 0
  return Math.ceil(rawQty / 20) * 20
}

/** Сумма data-линий (портов) по экранам: dataChains.length / summary.dataPorts */
function sumDataPorts(results: { result: RoutingResult }[]): number {
  return results.reduce((sum, { result }) => sum + result.summary.dataPorts, 0)
}

function sumPowerLines(results: { result: RoutingResult }[]): number {
  return results.reduce((sum, { result }) => sum + result.summary.powerLines, 0)
}

/** Количество роботов 32А: max(1, ceil(powerLines / 6)); без маршрутизации — undefined */
function resolveRobot32aCount(
  results: { result: RoutingResult }[],
): number | undefined {
  if (results.length === 0) return undefined
  const robotCount = Math.max(1, Math.ceil(sumPowerLines(results) / 6))
  return robotCount >= 1 ? robotCount : undefined
}

/** Авто-описание робота 32А при center feed на одном или нескольких экранах */
function aggregateRobot32aRussian(
  screens: ScreenConfig[],
  results: { screen: ScreenConfig; result: RoutingResult }[],
): string | undefined {
  const centerScreens = screens.filter((screen) => screen.powerFeedMode === 'center')
  if (centerScreens.length === 0) return undefined

  const centerIds = new Set(centerScreens.map((screen) => screen.id))
  const outletCount = results
    .filter(({ screen }) => centerIds.has(screen.id))
    .reduce((sum, { result }) => sum + result.summary.powerLines, 0)

  if (outletCount <= 0) return undefined
  return `Робот 32А + PDU distro (center feed), ${outletCount} outlet(s)`
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
    case 'opticCable': {
      // Если есть CVT — оптический кабель: суммарное qty CVT + 1
      const cvt = aggregateCvtOptical(results)
      return cvt.quantity > 0 ? cvt.quantity + 1 : undefined
    }
    case 'dataCables': {
      const raw = countDataTrunkAndLinkCables(cableSchedule)
      return roundUpToNext20(raw)
    }
    case 'commCableLong': {
      // Кол-во дата-линий × 2 + 10% (с округлением вверх)
      if (results.length === 0) return undefined
      const dataLines = sumDataPorts(results)
      if (dataLines === 0) return undefined
      return Math.ceil(dataLines * 2 * 1.1)
    }
    case 'speakons': {
      // Кол-во спиконов: сумма электрических линий + 2
      if (results.length === 0) return undefined
      return sumPowerLines(results) + 2
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
    case 'robot32a':
      return resolveRobot32aCount(results)
    case 'cable32a': {
      const robotCount = resolveRobot32aCount(results)
      return robotCount != null ? robotCount + 2 : undefined
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
    const hebrewManual = previous?.hebrewManual ?? false
    const russianManual = previous?.russianManual ?? false
    const ledCardAuto = template.id === 'led-card' ? aggregateLedCards(screens) : undefined
    const cvtAuto = template.id === 'cvt' ? aggregateCvtOptical(results) : undefined
    const robotAuto =
      template.id === 'robot-32a' ? aggregateRobot32aRussian(screens, results) : undefined
    const autoRussian = ledCardAuto?.russian ?? cvtAuto?.russian ?? robotAuto

    return {
      ...template,
      hebrew:
        hebrewManual && previous
          ? previous.hebrew
          : template.hebrew,
      russian:
        russianManual && previous
          ? previous.russian
          : (autoRussian ?? template.russian),
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
      hebrewManual,
      russianManual,
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

/** Границы как в шаблоне «רשימת ציוד לאירוע» */
const XLSX_BORDER_MEDIUM = { style: 'medium' as const, color: { argb: 'FF000000' } }
const XLSX_BORDER_THIN = { style: 'thin' as const, color: { argb: 'FF000000' } }
const XLSX_HEADER_FILL = {
  type: 'pattern' as const,
  pattern: 'solid' as const,
  fgColor: { argb: 'FFD8D8D8' },
  bgColor: { argb: 'FFD8D8D8' },
}

function underlineOrValue(value: string, blanks: string): string {
  const trimmed = value.trim()
  return trimmed || blanks
}

/** Экспорт в .xlsx (лист «לדים») — оформление как в оригинальном шаблоне */
export async function equipmentListToXlsxBlob(state: EquipmentListState): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default

  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('לדים', {
    views: [{ rightToLeft: true, state: 'normal', showGridLines: true }],
    properties: { defaultRowHeight: 15, defaultColWidth: 14.43 },
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      horizontalDpi: 4294967295,
      verticalDpi: 4294967295,
    },
  })

  worksheet.getColumn(1).width = 25.14
  worksheet.getColumn(2).width = 32
  worksheet.getColumn(3).width = 37
  worksheet.getColumn(4).width = 50.71

  const metaFont = { name: 'Arial', size: 12, bold: true, color: { theme: 1 } }
  const headerFont = { name: 'Arial', size: 14, bold: true, color: { theme: 1 } }
  const hebrewFont = { name: 'Arial', size: 12, color: { theme: 1 } }
  const bodyFont = { name: 'Arial', size: 11, color: { theme: 1 } }

  const dateLabel = `תאריך: ${underlineOrValue(state.meta.eventDate, '______________________')}`
  const eventLabel = `שם האירוע: ${underlineOrValue(state.meta.eventName, '____________________________')}`

  // Строки 1–4: дата / имя события (как в оригинале)
  const row1 = worksheet.getRow(1)
  row1.height = 14.25
  row1.getCell(1).value = dateLabel
  row1.getCell(1).font = metaFont
  row1.getCell(1).alignment = { readingOrder: 'ltr' }

  const row2 = worksheet.getRow(2)
  row2.height = 14.25

  const row3 = worksheet.getRow(3)
  row3.height = 14.25
  row3.getCell(1).value = eventLabel
  row3.getCell(1).font = metaFont
  row3.getCell(1).alignment = { readingOrder: 'ltr' }

  const row4 = worksheet.getRow(4)
  row4.height = 14.25

  // Строка 5: заголовки колонок
  const headerRowIndex = 5
  const headerRow = worksheet.getRow(headerRowIndex)
  headerRow.height = 14.25
  const headers = ['ציוד', 'Оборудование', 'כמויות', 'תופסות'] as const
  headers.forEach((title, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = title
    cell.font = headerFont
    cell.fill = XLSX_HEADER_FILL
    cell.alignment = {
      horizontal: 'center',
      ...(i !== 1 ? { readingOrder: 'ltr' as const } : {}),
    }
    cell.border = {
      left: XLSX_BORDER_MEDIUM,
      right: XLSX_BORDER_MEDIUM,
      top: XLSX_BORDER_MEDIUM,
      bottom: XLSX_BORDER_MEDIUM,
    }
  })

  const dataRows = getEquipmentListExportRows(state)
  const dataStart = headerRowIndex + 1
  const dataEnd =
    dataRows.length > 0 ? dataStart + dataRows.length - 1 : headerRowIndex

  dataRows.forEach((row, index) => {
    const rowIndex = dataStart + index
    const excelRow = worksheet.getRow(rowIndex)
    const lineCount = Math.max(
      1,
      String(row.quantity).split(/\r?\n/).length,
      String(row.russian).split(/\r?\n/).length,
    )
    excelRow.height = lineCount > 1 ? Math.max(14.25, lineCount * 14.25) : 14.25

    const isFirst = index === 0
    const isLast = index === dataRows.length - 1
    const topBorder = isFirst ? XLSX_BORDER_MEDIUM : XLSX_BORDER_THIN
    const bottomBorder = isLast ? XLSX_BORDER_MEDIUM : XLSX_BORDER_THIN

    const values = [row.hebrew, row.russian, row.quantity, row.footprint]
    values.forEach((value, colIndex) => {
      const cell = excelRow.getCell(colIndex + 1)
      cell.value = value
      cell.font = colIndex === 0 ? hebrewFont : bodyFont
      const multiline = String(value).includes('\n')
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle',
        wrapText: multiline || undefined,
        ...(colIndex !== 1 ? { readingOrder: 'ltr' as const } : {}),
      }
      cell.border = {
        left: XLSX_BORDER_MEDIUM,
        right: XLSX_BORDER_MEDIUM,
        top: topBorder,
        bottom: bottomBorder,
      }
    })
  })

  // Пустая закрывающая строка таблицы (как row 29 в оригинале)
  const tableCloseRow = dataEnd + 1
  const closeRow = worksheet.getRow(tableCloseRow)
  closeRow.height = 14.25
  for (let col = 1; col <= 4; col++) {
    const cell = closeRow.getCell(col)
    cell.font = bodyFont
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = {
      left: XLSX_BORDER_MEDIUM,
      right: XLSX_BORDER_MEDIUM,
      top: XLSX_BORDER_THIN,
      bottom: XLSX_BORDER_MEDIUM,
    }
  }

  // Разделитель, затем футер מיקום / שעות / איש קשר
  const gapRow = tableCloseRow + 1
  worksheet.getRow(gapRow).height = 14.25

  const footerStart = gapRow + 1
  const footerBlocks: { label: string; value: string; rowSpan: number }[] = [
    { label: 'מיקום:', value: state.meta.location, rowSpan: 2 },
    { label: 'שעות:', value: state.meta.hours, rowSpan: 2 },
    { label: 'איש קשר:', value: state.meta.contact, rowSpan: 1 },
  ]

  let footerRow = footerStart
  for (const block of footerBlocks) {
    const start = footerRow
    const end = footerRow + block.rowSpan - 1
    const text = block.value.trim() ? `${block.label} ${block.value}` : block.label

    worksheet.mergeCells(start, 1, end, 2)
    const cell = worksheet.getCell(start, 1)
    cell.value = text
    cell.font = metaFont
    cell.alignment = { horizontal: 'right', vertical: 'top', readingOrder: 'ltr', wrapText: true }

    for (let r = start; r <= end; r++) {
      worksheet.getRow(r).height = r === start && block.rowSpan > 1 ? 15.75 : 15
      for (let c = 1; c <= 2; c++) {
        const borderCell = worksheet.getCell(r, c)
        borderCell.border = {
          left: c === 1 ? XLSX_BORDER_MEDIUM : undefined,
          right: c === 2 ? XLSX_BORDER_MEDIUM : undefined,
          top: r === start ? XLSX_BORDER_MEDIUM : undefined,
          bottom: r === end ? XLSX_BORDER_MEDIUM : undefined,
        }
      }
    }

    footerRow = end + 1
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}
