import {
  downloadDataUrl,
  panelExportFilename,
  capturePanelPng,
} from './panelExport'
import {
  buildFullEventWorkbook,
  equipmentListPhoneRows,
  equipmentListToXlsxBlob,
  getDriveSheetFilename,
  getFullEventXlsxFilename,
  type EmbeddedSchemeImage,
  type EquipmentListState,
} from './equipmentList'
import { ensureDriveAccess, uploadSpreadsheetEditLink } from './googleDrive'
import { postSchemeForm } from './mapperUpload.js'
import type { TripBridge } from './tripBridge'

/** MIME полного Excel (список + схемы) */
export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export interface SchemeUploadFile {
  filename: string
  blob: Blob
  /** По умолчанию image/png; для Excel — XLSX_MIME */
  mimeType?: string
  /** base64 без data:-префикса — если уже известен */
  base64?: string
}

export interface TripUploadResult {
  ok: boolean
  uploaded?: number
  error?: string
}

/** Совместимость с прежними вызовами prepareSchemeBridge() — iframe создаёт postSchemeForm */
export interface SchemeBridgeHandle {
  nonce: string
  frameName: string
  iframe: HTMLIFrameElement | null
}

const CAPTURE_RATIO = 2

/** data URL → Blob PNG */
export async function dataUrlToPngBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl)
  return response.blob()
}

function stripPngDataUrlPrefix(dataUrl: string): string {
  const marker = 'base64,'
  const idx = dataUrl.indexOf(marker)
  if (idx === -1) return dataUrl
  return dataUrl.slice(idx + marker.length)
}

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsDataURL(blob)
  })
  return stripPngDataUrlPrefix(dataUrl)
}

function formatUploadError(raw: string, fallback: string): string {
  const text = raw.trim()
  if (!text) return fallback
  const lower = text.toLowerCase()
  if (lower.includes('unauthorized') || lower === 'unauthorized') {
    return (
      'unauthorized — сервер отклонил upload_token. ' +
      'Откройте mapper заново по свежей ссылке из бота и сразу нажмите «Отправить».'
    )
  }
  if (lower.includes('unsupported_mime')) {
    return (
      'unsupported_mime — сервер принимает только PNG (image/png). ' +
      'Excel (.xlsx) в этот endpoint не проходит; схемы PNG отправляем отдельно.'
    )
  }
  return text.length > 280 ? `${text.slice(0, 280)}…` : text
}

/**
 * Вызвать синхронно в onClick (до await) — оставлено для совместимости API.
 * Официальный postSchemeForm сам создаёт iframe.
 */
export function prepareSchemeBridge(): SchemeBridgeHandle {
  return { nonce: '', frameName: '', iframe: null }
}

function resolveUploadMime(file: SchemeUploadFile): string {
  if (file.mimeType) return file.mimeType
  if (file.blob.type) return file.blob.type
  if (/\.xlsx$/i.test(file.filename)) return XLSX_MIME
  return 'image/png'
}

async function toSchemeFilePayload(file: SchemeUploadFile): Promise<{
  name: string
  mimeType: string
  base64: string
}> {
  const mimeType = resolveUploadMime(file)
  const typedBlob =
    file.blob.type === mimeType ? file.blob : new Blob([file.blob], { type: mimeType })
  const base64 = file.base64 ?? (await blobToBase64(typedBlob))
  return {
    name: file.filename,
    mimeType,
    base64,
  }
}

async function captureSchemeFile(
  el: HTMLElement,
  mode: 'data' | 'power',
  screenName: string,
  eventName?: string,
): Promise<SchemeUploadFile> {
  const dataUrl = await capturePanelPng(el, CAPTURE_RATIO)
  if (!dataUrl.startsWith('data:image/png')) {
    throw new Error('Снимок схемы не в формате PNG')
  }
  const blob = await dataUrlToPngBlob(dataUrl)
  return {
    filename: panelExportFilename(mode, screenName || 'screen', eventName),
    blob: blob.type === 'image/png' ? blob : new Blob([blob], { type: 'image/png' }),
    mimeType: 'image/png',
    base64: stripPngDataUrlPrefix(dataUrl),
  }
}

/** Один PNG-файл схемы из DOM-элемента панели */
export async function buildSchemeFileFromElement(
  el: HTMLElement,
  mode: 'data' | 'power',
  screenName: string,
  eventName?: string,
): Promise<SchemeUploadFile> {
  return captureSchemeFile(el, mode, screenName, eventName)
}

/**
 * Снимает все видимые панели схем на странице (data + power).
 */
export async function collectSchemePngFiles(eventName?: string): Promise<SchemeUploadFile[]> {
  const dataPanels = [
    ...document.querySelectorAll<HTMLElement>('[data-scheme-panel="data"]'),
  ]
  const powerPanels = [
    ...document.querySelectorAll<HTMLElement>('[data-scheme-panel="power"]'),
  ]
  if (dataPanels.length === 0 && powerPanels.length === 0) {
    throw new Error('Схемы не найдены на странице. Дождитесь расчёта сетки.')
  }

  const files: SchemeUploadFile[] = []
  for (let i = 0; i < dataPanels.length; i++) {
    const screenHint =
      dataPanels[i]!.getAttribute('data-screen-name')?.trim() ||
      (dataPanels.length > 1 ? `screen-${i + 1}` : 'screen')
    files.push(await captureSchemeFile(dataPanels[i]!, 'data', screenHint, eventName))
  }
  for (let i = 0; i < powerPanels.length; i++) {
    const screenHint =
      powerPanels[i]!.getAttribute('data-screen-name')?.trim() ||
      (powerPanels.length > 1 ? `screen-${i + 1}` : 'screen')
    files.push(await captureSchemeFile(powerPanels[i]!, 'power', screenHint, eventName))
  }
  return files
}

/** Экран проекта для поочерёдного снимка схем */
export interface TripScreenCaptureTarget {
  id: string
  name: string
}

async function waitTwoAnimationFrames(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
}

/** Ждём DOM-панели схем после смены активного экрана */
export async function waitForSchemePanels(
  screenName: string,
  timeoutMs = 20000,
): Promise<void> {
  const started = Date.now()
  const want = screenName.trim()
  while (Date.now() - started < timeoutMs) {
    const dataEl = document.querySelector<HTMLElement>('[data-scheme-panel="data"]')
    const powerEl = document.querySelector<HTMLElement>('[data-scheme-panel="power"]')
    const shown =
      dataEl?.getAttribute('data-screen-name')?.trim() ||
      powerEl?.getAttribute('data-screen-name')?.trim() ||
      ''
    if (dataEl && powerEl && (!want || shown === want)) {
      await waitTwoAnimationFrames()
      // Дать роутингу дорисовать SVG
      await new Promise((r) => window.setTimeout(r, 120))
      return
    }
    await new Promise((r) => window.setTimeout(r, 50))
  }
  throw new Error(
    want
      ? `Схемы экрана «${want}» не появились. Дождитесь расчёта сетки.`
      : 'Схемы не найдены на странице. Дождитесь расчёта сетки.',
  )
}

/**
 * PNG Data/Power для всех экранов проекта (по очереди активирует экран).
 * Восстанавливает предыдущий activeScreenId в finally.
 */
export async function collectSchemePngFilesForScreens(
  screens: TripScreenCaptureTarget[],
  activeScreenId: string,
  activateScreen: (id: string) => void,
  eventName?: string,
  onProgress?: (message: string) => void,
): Promise<SchemeUploadFile[]> {
  if (screens.length === 0) {
    return collectSchemePngFiles(eventName)
  }
  const files: SchemeUploadFile[] = []
  try {
    for (let i = 0; i < screens.length; i++) {
      const screen = screens[i]!
      onProgress?.(
        screens.length > 1
          ? `Снимок экрана ${i + 1}/${screens.length}: ${screen.name || screen.id}`
          : 'Снимки схем…',
      )
      activateScreen(screen.id)
      await waitForSchemePanels(screen.name)
      const batch = await collectSchemePngFiles(eventName)
      files.push(...batch)
    }
  } finally {
    if (activeScreenId) activateScreen(activeScreenId)
  }
  if (files.length === 0) {
    throw new Error('Не удалось снять схемы ни с одного экрана.')
  }
  return files
}

/** Полный Excel (.xlsx) — для локального скачивания; в GAS даёт unsupported_mime */
export async function buildEventWorkbookUploadFile(
  state: EquipmentListState,
): Promise<SchemeUploadFile> {
  const blob = await buildFullEventWorkbook(state)
  const typed =
    blob.type === XLSX_MIME ? blob : new Blob([blob], { type: XLSX_MIME })
  return {
    filename: getFullEventXlsxFilename(state.meta),
    blob: typed,
    mimeType: XLSX_MIME,
  }
}

function wrapCanvasLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const source = String(text ?? '').replace(/\r/g, '')
  if (!source) return ['']
  const lines: string[] = []
  for (const paragraph of source.split('\n')) {
    if (!paragraph) {
      lines.push('')
      continue
    }
    let line = ''
    for (const ch of paragraph) {
      const next = line + ch
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line)
        line = ch.trim() ? ch : ''
      } else {
        line = next
      }
    }
    lines.push(line)
  }
  return lines.length > 0 ? lines : ['']
}

/** Один экран iPhone: картинка открывается на весь экран, без полей сбоку. */
const EQUIPMENT_LIST_SCREEN_W = 390
const EQUIPMENT_LIST_SCREEN_H = 844

export function equipmentListPageFilename(page: number, pages: number): string {
  const base = 'schema-screen-equipment-list'
  if (pages <= 1) return `${base}.png`
  return `${base}-${page}.png`
}

/** Колонки как в Excel, справа налево: ציוד, Оборудование, כמויות, תופסות. */
const EQUIPMENT_LIST_COLUMNS: {
  key: 'hebrew' | 'russian' | 'quantity' | 'footprint'
  title: string
  width: number
  rtl: boolean
}[] = [
  { key: 'footprint', title: 'תופסות', width: 52, rtl: true },
  { key: 'quantity', title: 'כמויות', width: 118, rtl: false },
  { key: 'russian', title: 'Оборудование', width: 128, rtl: false },
  { key: 'hebrew', title: 'ציוד', width: 92, rtl: true },
]

/**
 * Список оборудования как лист Excel на весь экран iPhone.
 * Колонки и названия те же: ציוד, Оборудование, כמויות, תופסות.
 * Пустые строки шаблона не рисуются. Сбоку нет отдельной колонки с цифрами.
 */
export async function buildEquipmentListPngUploadFiles(
  state: EquipmentListState,
): Promise<SchemeUploadFile[]> {
  const rows = equipmentListPhoneRows(state)
  const scale = 3
  const fontHeader = 'bold 14px Arial, "Segoe UI", sans-serif'
  const fontCell = '15px Arial, "Segoe UI", sans-serif'
  const fontMeta = 'bold 14px Arial, "Segoe UI", sans-serif'
  const lineH = 18
  const cellPad = 4
  const headerH = 32
  const minRowH = 36

  const measure = document.createElement('canvas').getContext('2d')
  if (!measure) throw new Error('Canvas недоступен')

  const wrap = (text: string, font: string, width: number): string[] => {
    measure.font = font
    const maxWidth = Math.max(8, width)
    const lines: string[] = []
    const pushLongWord = (word: string) => {
      let chunk = ''
      for (const ch of word) {
        const next = chunk + ch
        if (chunk && measure.measureText(next).width > maxWidth) {
          lines.push(chunk)
          chunk = ch
        } else {
          chunk = next
        }
      }
      if (chunk) lines.push(chunk)
    }
    for (const paragraph of String(text ?? '').replace(/\r/g, '').split('\n')) {
      const words = paragraph.trim().split(/\s+/).filter(Boolean)
      if (words.length === 0) {
        lines.push('')
        continue
      }
      let line = ''
      for (const word of words) {
        if (measure.measureText(word).width > maxWidth) {
          if (line) lines.push(line)
          pushLongWord(word)
          line = ''
          continue
        }
        const next = line ? `${line} ${word}` : word
        if (line && measure.measureText(next).width > maxWidth) {
          lines.push(line)
          line = word
        } else {
          line = next
        }
      }
      if (line) lines.push(line)
    }
    return lines.length > 0 ? lines : ['']
  }

  const columnWidth = (key: (typeof EQUIPMENT_LIST_COLUMNS)[number]['key']) =>
    EQUIPMENT_LIST_COLUMNS.find((column) => column.key === key)!.width

  const meta = state.meta
  const metaText = [
    meta.eventDate ? `תאריך: ${meta.eventDate}` : '',
    meta.eventName ? `שם האירוע: ${meta.eventName}` : '',
  ]
    .filter(Boolean)
    .join('   ')
  const metaLines = metaText
    ? wrap(metaText, fontMeta, EQUIPMENT_LIST_SCREEN_W - 12)
    : []
  const metaH = metaLines.length > 0 ? metaLines.length * lineH + 10 : 0

  const measured = rows.map((row) => {
    const lines = {
      hebrew: wrap(row.hebrew.trim(), fontCell, columnWidth('hebrew') - cellPad * 2),
      russian: wrap(row.russian.trim(), fontCell, columnWidth('russian') - cellPad * 2),
      quantity: wrap(row.quantity.trim(), fontCell, columnWidth('quantity') - cellPad * 2),
      footprint: wrap(row.footprint.trim(), fontCell, columnWidth('footprint') - cellPad * 2),
    }
    const lineCount = Math.max(
      1,
      lines.hebrew.length,
      lines.russian.length,
      lines.quantity.length,
      lines.footprint.length,
    )
    return {
      lines,
      height: Math.max(minRowH, lineCount * lineH + cellPad * 2),
    }
  })

  const pages: (typeof measured)[] = []
  let page: typeof measured = []
  let used = headerH + (pages.length === 0 ? metaH : 0)
  for (const row of measured) {
    const chrome = headerH + (pages.length === 0 && page.length === 0 ? metaH : 0)
    if (page.length > 0 && used + row.height > EQUIPMENT_LIST_SCREEN_H) {
      pages.push(page)
      page = []
      used = headerH
    }
    if (page.length === 0) used = chrome
    page.push(row)
    used += row.height
  }
  if (page.length > 0) pages.push(page)
  if (pages.length === 0) pages.push([])

  const files: SchemeUploadFile[] = []
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const pageRows = pages[pageIndex]!
    const topChrome = (pageIndex === 0 ? metaH : 0) + headerH
    const rowsH = pageRows.reduce((sum, row) => sum + row.height, 0)
    const logicalH = Math.max(EQUIPMENT_LIST_SCREEN_H, topChrome + rowsH)
    const canvas = document.createElement('canvas')
    canvas.width = EQUIPMENT_LIST_SCREEN_W * scale
    canvas.height = logicalH * scale
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas недоступен')
    ctx.scale(scale, scale)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, EQUIPMENT_LIST_SCREEN_W, logicalH)
    ctx.textBaseline = 'top'
    ctx.lineWidth = 1
    ctx.strokeStyle = '#000000'
    ctx.fillStyle = '#000000'

    let y = 0
    if (pageIndex === 0 && metaLines.length > 0) {
      ctx.font = fontMeta
      ctx.direction = 'rtl'
      ctx.textAlign = 'right'
      ctx.fillStyle = '#000000'
      metaLines.forEach((line, index) => {
        ctx.fillText(line, EQUIPMENT_LIST_SCREEN_W - 6, 6 + index * lineH)
      })
      y = metaH
    }

    const paintCell = (
      textLines: string[],
      x: number,
      top: number,
      width: number,
      height: number,
      font: string,
      rtl: boolean,
      fill?: string,
    ) => {
      if (fill) {
        ctx.fillStyle = fill
        ctx.fillRect(x, top, width, height)
      }
      ctx.strokeStyle = '#000000'
      ctx.strokeRect(x + 0.5, top + 0.5, width - 1, height - 1)
      ctx.font = font
      ctx.direction = rtl ? 'rtl' : 'ltr'
      ctx.textAlign = 'center'
      ctx.fillStyle = '#000000'
      const blockH = textLines.length * lineH
      let textY = top + Math.max(cellPad, (height - blockH) / 2)
      const shown = textLines.length > 0 ? textLines : ['']
      for (const line of shown) {
        if (textY + lineH > top + height) break
        ctx.fillText(line, x + width / 2, textY)
        textY += lineH
      }
    }

    let x = 0
    for (const column of EQUIPMENT_LIST_COLUMNS) {
      paintCell([column.title], x, y, column.width, headerH, fontHeader, column.rtl, '#d8d8d8')
      x += column.width
    }
    y += headerH

    const data = pageRows.length > 0 ? pageRows : []
    for (const row of data) {
      x = 0
      for (const column of EQUIPMENT_LIST_COLUMNS) {
        paintCell(row.lines[column.key], x, y, column.width, row.height, fontCell, column.rtl)
        x += column.width
      }
      y += row.height
    }

    while (y + minRowH <= EQUIPMENT_LIST_SCREEN_H && y + minRowH <= logicalH) {
      x = 0
      for (const column of EQUIPMENT_LIST_COLUMNS) {
        paintCell([''], x, y, column.width, minRowH, fontCell, column.rtl)
        x += column.width
      }
      y += minRowH
    }

    const dataUrl = canvas.toDataURL('image/png')
    if (!dataUrl.startsWith('data:image/png') || dataUrl.length < 800) {
      throw new Error('PNG списка оборудования получился пустым')
    }
    const blob = await dataUrlToPngBlob(dataUrl)
    if (blob.size < 1500) {
      throw new Error('PNG списка оборудования получился пустым')
    }
    files.push({
      filename: equipmentListPageFilename(pageIndex + 1, pages.length),
      blob: blob.type === 'image/png' ? blob : new Blob([blob], { type: 'image/png' }),
      mimeType: 'image/png',
      base64: stripPngDataUrlPrefix(dataUrl),
    })
  }
  return files
}

/** Первая страница списка. Для отправки используйте buildEquipmentListPngUploadFiles. */
export async function buildEquipmentListPngUploadFile(
  state: EquipmentListState,
): Promise<SchemeUploadFile> {
  const files = await buildEquipmentListPngUploadFiles(state)
  const first = files[0]
  if (!first) throw new Error('PNG списка оборудования получился пустым')
  return first
}
export interface TripPackFiles {
  /** Схемы PNG всех экранов */
  pngs: SchemeUploadFile[]
  /** Список оборудования как PNG (эквивалент Excel для GAS). Первая страница. */
  excel: SchemeUploadFile | null
  /** Все страницы списка для iPhone */
  equipmentPngs?: SchemeUploadFile[]
}

/**
 * Пакет в выезд: PNG всех экранов + список оборудования (PNG вместо xlsx).
 */
export async function collectTripPackFiles(
  state: EquipmentListState | null | undefined,
  eventName?: string,
  screenCapture?: {
    screens: TripScreenCaptureTarget[]
    activeScreenId: string
    activateScreen: (id: string) => void
    onProgress?: (message: string) => void
  },
  options?: { includeEquipmentPng?: boolean },
): Promise<TripPackFiles> {
  const name = eventName || state?.meta.eventName
  const pngs = screenCapture
    ? await collectSchemePngFilesForScreens(
        screenCapture.screens,
        screenCapture.activeScreenId,
        screenCapture.activateScreen,
        name,
        screenCapture.onProgress,
      )
    : await collectSchemePngFiles(name)
  let excel: SchemeUploadFile | null = null
  let equipmentPngs: SchemeUploadFile[] = []
  const includeEquipmentPng = options?.includeEquipmentPng !== false
  if (state && includeEquipmentPng) {
    screenCapture?.onProgress?.('Сборка списка оборудования (PNG)…')
    equipmentPngs = await buildEquipmentListPngUploadFiles(state)
    excel = equipmentPngs[0] ?? null
  }
  return { pngs, excel, equipmentPngs }
}

/**
 * Excel списка и схем → Google Таблица.
 * Возвращает только ссылку: файл по ней можно править.
 */
function schemeFileTitle(filename: string): string {
  const kind = filename.startsWith('power-lines')
    ? 'חשמל / Хашмаль'
    : filename.startsWith('data-ports')
      ? 'תקשורת / Тикшорет'
      : filename.replace(/\.png$/i, '')
  const slug = filename
    .replace(/^(data-ports|power-lines)-/, '')
    .replace(/\.png$/i, '')
    .trim()
  return slug ? `${kind} — ${slug}` : kind
}

/** Те же PNG, что уходят в карточку, чтобы ссылка не снимала схему второй раз */
export function schemeFilesToEmbedded(files: SchemeUploadFile[] | undefined): EmbeddedSchemeImage[] {
  if (!files) return []
  return files.flatMap((file) => {
    if (!file.base64) return []
    if (file.mimeType && file.mimeType !== 'image/png') return []
    return [
      {
        title: schemeFileTitle(file.filename),
        dataUrl: `data:image/png;base64,${file.base64}`,
        captureRatio: CAPTURE_RATIO,
      },
    ]
  })
}

export async function publishEventWorkbookEditLink(
  state: EquipmentListState,
  schemeFiles?: SchemeUploadFile[],
): Promise<string> {
  await ensureDriveAccess()
  const embedded = schemeFilesToEmbedded(schemeFiles)
  const blob = embedded.length
    ? await equipmentListToXlsxBlob(state, embedded)
    : await buildFullEventWorkbook(state)
  return uploadSpreadsheetEditLink(blob, getDriveSheetFilename(state.meta))
}

const SHEETS_LINK = /^https:\/\/docs\.google\.com\/spreadsheets\//

function sheetsLinks(urls: string[] | undefined): string[] {
  return (urls ?? []).filter((url) => SHEETS_LINK.test(url))
}

/**
 * Маленький Excel: ячейка A1 — гиперссылка, примечание к ячейке — тот же адрес.
 * Карточка может отклонить не-PNG; тогда файл просто не попадёт в выезд.
 */
export async function buildExcelHyperlinkUploadFile(
  editLink: string,
): Promise<SchemeUploadFile> {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Excel')
  sheet.getColumn(1).width = 80
  const cell = sheet.getCell('A1')
  cell.value = { text: 'Открыть Excel', hyperlink: editLink }
  cell.font = { name: 'Arial', size: 14, color: { argb: 'FF1D4ED8' }, underline: true }
  cell.note = editLink
  sheet.getCell('A2').value = editLink
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: XLSX_MIME })
  return {
    filename: 'Excel.xlsx',
    blob,
    mimeType: XLSX_MIME,
  }
}

/** Отдельный запрос: Excel со ссылкой внутри. Отказ сервера не роняет схемы. */
export async function uploadExcelHyperlinkFile(
  bridge: TripBridge,
  editLink: string,
  schemeLinks?: string[] | string,
): Promise<boolean> {
  const file = await buildExcelHyperlinkUploadFile(editLink)
  const result = await uploadSchemeImagesToTrip(
    bridge,
    [file],
    null,
    editLink,
    schemeLinks,
  )
  return result.ok
}

/**
 * PNG для карточки выезда: GAS принимает только image/png,
 * поэтому ссылка на таблицу уходит картинкой с адресом.
 */
export async function buildDriveEditLinkPng(editLink: string): Promise<SchemeUploadFile> {
  const scale = 2
  const width = 1400
  const pad = 48
  const font = '28px Arial, "Segoe UI", sans-serif'
  const fontTitle = 'bold 36px Arial, "Segoe UI", sans-serif'
  const measure = document.createElement('canvas').getContext('2d')
  if (!measure) throw new Error('Canvas недоступен')
  measure.font = font
  const urlLines = wrapCanvasLine(measure, editLink, width - pad * 2)
  const lineH = 40
  const height = pad + 52 + 36 + urlLines.length * lineH + 48 + pad

  const canvas = document.createElement('canvas')
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas недоступен')
  ctx.scale(scale, scale)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#0f172a'
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.direction = 'ltr'
  ctx.font = fontTitle
  ctx.fillText('Excel — ссылка для правки', pad, pad)
  ctx.font = '22px Arial, "Segoe UI", sans-serif'
  ctx.fillStyle = '#334155'
  ctx.fillText('Google Таблица. По ссылке можно править.', pad, pad + 52)
  ctx.font = font
  ctx.fillStyle = '#1d4ed8'
  urlLines.forEach((line, i) => {
    ctx.fillText(line, pad, pad + 52 + 36 + i * lineH)
  })

  const dataUrl = canvas.toDataURL('image/png')
  if (!dataUrl.startsWith('data:image/png') || dataUrl.length < 800) {
    throw new Error('PNG ссылки на Excel получился пустым')
  }
  const blob = await dataUrlToPngBlob(dataUrl)
  return {
    filename: 'excel-edit-link.png',
    blob: blob.type === 'image/png' ? blob : new Blob([blob], { type: 'image/png' }),
    mimeType: 'image/png',
    base64: stripPngDataUrlPrefix(dataUrl),
  }
}

/**
 * В выезд: PNG схем и ссылка на Excel (Google Таблица, править по ссылке).
 */
export async function sendAllSchemes(
  bridge: TripBridge,
  state: EquipmentListState | null | undefined,
  eventName?: string,
  screenCapture?: {
    screens: TripScreenCaptureTarget[]
    activeScreenId: string
    activateScreen: (id: string) => void
    onProgress?: (message: string) => void
  },
  onStatus?: (message: string) => void,
): Promise<{
  uploaded: number
  editLink: string | null
  /** Запрос со schemeLinks принят — карточка показывает блок «Ссылки на Google Таблицы» */
  linkInTrip: boolean
  /** Карточка приняла Excel.xlsx со ссылкой в ячейке и в примечании */
  excelInTrip: boolean
}> {
  onStatus?.('Вход в Google Drive…')
  await ensureDriveAccess()
  onStatus?.('Сборка схем и списка…')
  const pack = await collectTripPackFiles(
    state,
    eventName || state?.meta.eventName,
    screenCapture,
    { includeEquipmentPng: true },
  )

  let editLink: string | null = null
  if (state) {
    try {
      onStatus?.('Excel на Google Drive…')
      editLink = await publishEventWorkbookEditLink(state, pack.pngs)
    } catch {
      editLink = null
    }
  }

  // Один запрос: список и схемы. Повторный запрос со ссылкой затирал список
  // и добавлял схемы второй раз. Ссылка — одно поле schemeLinks.
  onStatus?.(
    pack.equipmentPngs?.length
      ? 'Список и схемы в карточку…'
      : 'Отправка схем…',
  )
  try {
    const uploadedFiles = await uploadTripPackToTrip(
      bridge,
      pack,
      onStatus,
      undefined,
      editLink ? [editLink] : undefined,
    )
    return {
      uploaded: uploadedFiles.uploaded,
      editLink,
      linkInTrip: Boolean(editLink),
      excelInTrip: false,
    }
  } catch (error) {
    if (!editLink) throw error
    const message = error instanceof Error ? error.message : 'Не удалось отправить файлы'
    throw new Error(`${message}\nСсылка на Excel:\n${editLink}`)
  }
}

/** Текст после отправки: что именно карточка могла принять */
export function describeTripSendResult(result: {
  uploaded: number
  editLink: string | null
  linkInTrip: boolean
  excelInTrip: boolean
}): { status: string; confirm: string } {
  const lines = [`В выезд отправлено файлов: ${result.uploaded}.`]
  if (result.linkInTrip) {
    lines.push(
      'В карточке блок «Ссылки на Google Таблицы» — по ссылке можно перейти.',
    )
  }
  if (result.excelInTrip) {
    lines.push(
      'Файл Excel.xlsx: ячейка A1 — ссылка, в примечании к ячейке тот же адрес.',
    )
  }
  if (result.editLink && !result.linkInTrip) {
    lines.push(`Карточка не сохранила кликабельную ссылку. Адрес:\n${result.editLink}`)
  } else if (result.editLink) {
    lines.push(result.editLink)
  }
  lines.push('', 'Открыть карточку выезда?')
  const status = !result.editLink
    ? `В выезде схемы: ${result.uploaded}`
    : result.linkInTrip && result.excelInTrip
      ? `Схемы, ссылка в карточке и Excel.xlsx (${result.uploaded}).`
      : result.linkInTrip
        ? `Схемы и ссылка в блоке «Ссылки на Google Таблицы» (${result.uploaded}).`
        : 'Схемы в выезде. Карточка не сохранила ссылку.'
  return { status, confirm: lines.join('\n') }
}

/** Плоский список для локального скачивания / upload */
export function flattenTripPackFiles(pack: TripPackFiles): SchemeUploadFile[] {
  const list =
    pack.equipmentPngs && pack.equipmentPngs.length > 0
      ? pack.equipmentPngs
      : pack.excel
        ? [pack.excel]
        : []
  return [...list, ...pack.pngs]
}

export interface UploadTripPackResult {
  uploaded: number
  excelUploaded: boolean
  excelError?: string
}

/**
 * Отправка файлов (PNG и/или xlsx) через официальный postSchemeForm.
 * Важно: в payload добавляются transportNonce + clientOrigin внутри JSON.
 */
export async function uploadSchemeImagesToTrip(
  bridge: TripBridge,
  files: SchemeUploadFile[],
  _bridgeHandle?: SchemeBridgeHandle | null,
  excelUrl?: string,
  schemeLinks?: string[] | string,
): Promise<TripUploadResult> {
  if (!bridge.uploadUrl || !bridge.uploadToken || !bridge.tripId) {
    return { ok: false, error: 'Нет данных выезда (upload_url / token / trip_id)' }
  }
  if (files.length === 0) {
    return { ok: false, error: 'Нет файлов для отправки' }
  }
  if (files.length > 5) {
    return { ok: false, error: 'Можно отправить 1–5 файлов за один раз.' }
  }

  await ensureDriveAccess()

  try {
    for (const file of files) {
      if (file.blob.size > 5 * 1024 * 1024) {
        return { ok: false, error: `Файл «${file.filename}» больше 5 МБ.` }
      }
    }
    const total = files.reduce((n, f) => n + f.blob.size, 0)
    if (total > 10 * 1024 * 1024) {
      return { ok: false, error: 'Сумма файлов до 10 МБ.' }
    }

    const filePayloads = await Promise.all(files.map((file) => toSchemeFilePayload(file)))
    const linkList = sheetsLinks(
      typeof schemeLinks === 'string' ? schemeLinks.split(/\r?\n/) : schemeLinks,
    )
    // Форма «Добавить файлы» шлёт одну строку на ссылку, карточка хранит массив.
    // Строка наверху — как в форме. Массив в meta — если сервер копирует meta на работу.
    const result = await postSchemeForm(bridge.uploadUrl, {
      action: 'uploadSchemeImages',
      trip_id: bridge.tripId,
      upload_token: bridge.uploadToken,
      files: filePayloads,
      // Одно поле. Строка и массив вместе давали две одинаковые ссылки в карточке.
      ...(linkList.length
        ? { schemeLinks: linkList.join('\n') }
        : excelUrl
          ? { schemeLinks: excelUrl }
          : {}),
      meta: {
        source: 'led-cable-mapper',
        title: bridge.title || undefined,
        types: bridge.types || undefined,
      },
    })

    if (!result?.ok) {
      return {
        ok: false,
        error: formatUploadError(
          [result?.error, result?.detail].filter(Boolean).join(': '),
          'Ошибка загрузки',
        ),
      }
    }
    return {
      ok: true,
      uploaded: typeof result.uploaded === 'number' ? result.uploaded : files.length,
    }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? formatUploadError(error.message, error.message)
          : 'Не удалось отправить схемы в выезд',
    }
  }
}

/**
 * Отправка пакета: список оборудования (PNG) + схемы всех экранов, пачками по 5.
 * Excel как .xlsx на GAS даёт unsupported_mime — поэтому список уходит PNG.
 */
export async function uploadTripPackToTrip(
  bridge: TripBridge,
  pack: TripPackFiles,
  onStatus?: (message: string) => void,
  excelUrl?: string,
  schemeLinks?: string[] | string,
): Promise<UploadTripPackResult> {
  const allFiles = flattenTripPackFiles(pack)
  if (allFiles.length === 0) {
    throw new Error('Нет файлов для отправки')
  }
  const batches = chunkFilesByLimits(allFiles)
  let uploaded = 0
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!
    onStatus?.(
      batches.length > 1
        ? `Отправка ${i + 1}/${batches.length}…`
        : pack.excel
          ? 'Отправка списка и схем…'
          : 'Отправка схем…',
    )
    const result = await uploadSchemeImagesToTrip(
      bridge,
      batch,
      null,
      excelUrl,
      i === 0 ? schemeLinks : undefined,
    )
    if (!result.ok) {
      throw new Error(result.error || 'Ошибка загрузки')
    }
    uploaded += result.uploaded ?? batch.length
  }
  return {
    uploaded,
    excelUploaded: Boolean(pack.excel),
  }
}

/** Пачки: не больше 5 файлов и 8 МБ, иначе Apps Script отклоняет весь запрос. */
export function chunkFilesByLimits<T extends { blob: Blob }>(
  items: T[],
  maxFiles = 5,
  maxBytes = 8 * 1024 * 1024,
): T[][] {
  const chunks: T[][] = []
  let current: T[] = []
  let size = 0
  for (const item of items) {
    const next = item.blob.size
    const full =
      current.length > 0 && (current.length >= maxFiles || size + next > maxBytes)
    if (full) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(item)
    size += next
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

/** Режет список на пачки по maxFiles (лимит GAS ≈ 5). */
export function chunkFiles<T>(items: T[], maxFiles = 5): T[][] {
  if (maxFiles < 1) return [items]
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += maxFiles) {
    chunks.push(items.slice(i, i + maxFiles))
  }
  return chunks
}

/** Сохранить файлы на диск (обход, если GAS отклонил токен). */
export async function downloadSchemeFilesLocally(
  files: SchemeUploadFile[],
): Promise<number> {
  let n = 0
  for (const file of files) {
    const mime = resolveUploadMime(file)
    if (file.base64) {
      downloadDataUrl(`data:${mime};base64,${file.base64}`, file.filename)
    } else {
      const url = URL.createObjectURL(file.blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = file.filename
      anchor.click()
      URL.revokeObjectURL(url)
    }
    n += 1
    await new Promise((r) => window.setTimeout(r, 120))
  }
  return n
}

const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

export interface TripDiagnoseProbe {
  id: string
  title: string
  ok: boolean | null
  error: string | null
  ms: number
  note?: string
}

/**
 * Зонд через официальный postSchemeForm (тот же контракт, что кнопка Отправить).
 */
export async function diagnoseTripUpload(bridge: TripBridge): Promise<{
  summary: string
  probes: TripDiagnoseProbe[]
  verdict: string
}> {
  const tiny = {
    name: 'diag-probe.png',
    mimeType: 'image/png',
    base64: TINY_PNG_B64,
  }

  const run = async (
    id: string,
    title: string,
    patch: Partial<{
      upload_token: string
      trip_id: string
      files: typeof tiny[]
    }> = {},
    note?: string,
  ): Promise<TripDiagnoseProbe> => {
    const started = Date.now()
    try {
      const result = await postSchemeForm(bridge.uploadUrl, {
        action: 'uploadSchemeImages',
        trip_id: patch.trip_id ?? bridge.tripId,
        upload_token: patch.upload_token ?? bridge.uploadToken,
        files: patch.files ?? [tiny],
        meta: { source: 'led-cable-mapper', title: bridge.title || 'diag' },
      })
      return {
        id,
        title,
        ok: Boolean(result.ok),
        error: result.ok
          ? null
          : [result.error, result.detail].filter(Boolean).join(': ') || 'error',
        ms: Date.now() - started,
        note,
      }
    } catch (error) {
      return {
        id,
        title,
        ok: null,
        error: error instanceof Error ? error.message : String(error),
        ms: Date.now() - started,
        note,
      }
    }
  }

  const probes: TripDiagnoseProbe[] = []
  probes.push(
    await run('A_normal', 'A. Нормальный payload (официальный postSchemeForm)'),
  )
  probes.push(
    await run('B_no_token', 'B. Без upload_token', { upload_token: '' }, 'другая ошибка → токен читается'),
  )
  probes.push(
    await run(
      'C_bad_token',
      'C. Фейковый token',
      { upload_token: '00000000000000000000000000000000' },
    ),
  )
  probes.push(
    await run('D_no_files', 'D. Пустой files[]', { files: [] }),
  )
  probes.push(
    await run('F_wrong_trip', 'F. Чужой trip_id', {
      trip_id: '00000000000000000000000000000000',
    }),
  )

  const errOf = (id: string) =>
    probes.find((p) => p.id === id)?.error?.toLowerCase() ?? ''
  const a = errOf('A_normal')
  const b = errOf('B_no_token')
  const c = errOf('C_bad_token')

  let verdict: string
  if (probes.some((p) => p.ok === true)) {
    verdict = 'Есть успешный probe — upload на GAS работает.'
  } else if (
    a.includes('unauthorized') &&
    b.includes('unauthorized') &&
    c.includes('unauthorized')
  ) {
    verdict =
      'Официальный postSchemeForm подключён; GAS всё ещё отвечает unauthorized на любой токен. Чинить проверку upload_token / Storage на стороне Apps Script.'
  } else if (a.includes('нет ответа') || a.includes('timeout')) {
    verdict =
      'Нет postMessage с matching nonce. GAS должен эхать scheme_nonce в packet.nonce и channel=crew-scheme-response.'
  } else {
    verdict = 'Смотрите таблицу probe в console.'
  }

  console.group('[TripUpload DIAG]')
  console.log('bridge', {
    tripId: bridge.tripId,
    tokenPrefix: bridge.uploadToken.slice(0, 16),
    uploadUrl: bridge.uploadUrl,
    origin: window.location.origin,
    bridgeFile: 'src/lib/mapperUpload.js (official postSchemeForm)',
  })
  console.table(
    probes.map((p) => ({
      id: p.id,
      title: p.title,
      ok: p.ok,
      error: p.error,
      ms: p.ms,
    })),
  )
  console.log('VERDICT:', verdict)
  console.groupEnd()

  const summary = [
    'Диагностика upload (официальный mapper-upload.js)',
    `trip: ${bridge.tripId}`,
    `token: ${bridge.uploadToken.slice(0, 16)}… (${bridge.uploadToken.length})`,
    `origin: ${window.location.origin}`,
    '',
    ...probes.map(
      (p) => `${p.id}: ok=${String(p.ok)} err=${p.error ?? '—'} (${p.ms}ms)`,
    ),
    '',
    `ВЫВОД: ${verdict}`,
    '',
    'Подробности: Console → [TripUpload DIAG]',
  ].join('\n')

  return { summary, probes, verdict }
}
