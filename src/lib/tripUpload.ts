import {
  downloadDataUrl,
  panelExportFilename,
  capturePanelPng,
} from './panelExport'
import {
  buildFullEventWorkbook,
  getEquipmentListExportRows,
  getFullEventXlsxFilename,
  type EquipmentListState,
} from './equipmentList'
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

/**
 * Список оборудования из того же набора строк, что и Excel, рисуется в PNG.
 * html-to-image за экраном давал пустой файл; canvas всегда содержит таблицу.
 * GAS не принимает .xlsx (unsupported_mime) — в выезд уходит этот PNG вместе со схемами.
 */
export async function buildEquipmentListPngUploadFile(
  state: EquipmentListState,
): Promise<SchemeUploadFile> {
  const filename = getFullEventXlsxFilename(state.meta).replace(/\.xlsx$/i, '.png')
  const rows = getEquipmentListExportRows(state)
  const meta = state.meta
  const metaLines = [
    meta.eventDate ? `תאריך: ${meta.eventDate}` : '',
    meta.eventName ? `שם האירוע: ${meta.eventName}` : '',
    meta.location ? `מיקום: ${meta.location}` : '',
    meta.hours ? `שעות: ${meta.hours}` : '',
    meta.contact ? `איש קשר: ${meta.contact}` : '',
    meta.car ? `רכב: ${meta.car}` : '',
    meta.types ? `סוג: ${meta.types}` : '',
  ].filter(Boolean)

  const scale = 2
  const pad = 28
  const tableW = 1320
  const colW = [300, 520, 260, 240]
  const lineH = 22
  const cellPadX = 10
  const cellPadY = 8
  const font = '16px Arial, "Segoe UI", sans-serif'
  const fontBold = 'bold 16px Arial, "Segoe UI", sans-serif'
  const fontTitle = 'bold 26px Arial, "Segoe UI", sans-serif'

  const measure = document.createElement('canvas').getContext('2d')
  if (!measure) throw new Error('Canvas недоступен')

  const cellLines = (
    text: string,
    width: number,
    bold: boolean,
  ): string[] => {
    measure.font = bold ? fontBold : font
    return wrapCanvasLine(measure, text, Math.max(20, width - cellPadX * 2))
  }

  const headers = ['ציוד', 'Оборудование', 'כמויות', 'תופסות']
  const headerHeights = headers.map((title, i) => {
    const lines = cellLines(title, colW[i]!, true)
    return Math.max(36, lines.length * lineH + cellPadY * 2)
  })
  const headerH = Math.max(...headerHeights)

  const body = rows.map((row) => {
    const values = [row.hebrew, row.russian, row.quantity, row.footprint]
    const wrapped = values.map((value, i) => cellLines(value, colW[i]!, false))
    const height = Math.max(
      34,
      ...wrapped.map((lines) => lines.length * lineH + cellPadY * 2),
    )
    return { wrapped, height }
  })

  measure.font = font
  const metaBlockH = metaLines.length * 24
  const titleH = 40
  const tableH = headerH + body.reduce((n, row) => n + row.height, 0)
  const logicalW = pad * 2 + tableW
  const logicalH = pad + titleH + metaBlockH + 16 + tableH + pad

  const canvas = document.createElement('canvas')
  canvas.width = logicalW * scale
  canvas.height = logicalH * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas недоступен')
  ctx.scale(scale, scale)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, logicalW, logicalH)

  ctx.fillStyle = '#0f172a'
  ctx.font = fontTitle
  ctx.direction = 'rtl'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.fillText('רשימת ציוד לאירוע', logicalW - pad, pad)

  ctx.font = font
  ctx.fillStyle = '#334155'
  metaLines.forEach((line, i) => {
    ctx.fillText(line, logicalW - pad, pad + titleH + i * 24)
  })

  const tableX = pad
  const tableY = pad + titleH + metaBlockH + 16

  const paintCell = (
    x: number,
    y: number,
    w: number,
    h: number,
    lines: string[],
    opts: { bold?: boolean; rtl?: boolean; fill?: string },
  ) => {
    ctx.fillStyle = opts.fill ?? '#ffffff'
    ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = '#64748b'
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
    ctx.save()
    ctx.beginPath()
    ctx.rect(x + cellPadX, y + cellPadY, w - cellPadX * 2, h - cellPadY * 2)
    ctx.clip()
    ctx.font = opts.bold ? fontBold : font
    ctx.fillStyle = '#0f172a'
    ctx.direction = opts.rtl ? 'rtl' : 'ltr'
    ctx.textAlign = opts.rtl ? 'right' : 'left'
    ctx.textBaseline = 'top'
    const tx = opts.rtl ? x + w - cellPadX : x + cellPadX
    lines.forEach((line, i) => {
      ctx.fillText(line, tx, y + cellPadY + i * lineH)
    })
    ctx.restore()
  }

  let x = tableX
  headers.forEach((title, i) => {
    const rtl = i !== 1
    paintCell(x, tableY, colW[i]!, headerH, cellLines(title, colW[i]!, true), {
      bold: true,
      rtl,
      fill: '#e2e8f0',
    })
    x += colW[i]!
  })

  let y = tableY + headerH
  for (const row of body) {
    x = tableX
    row.wrapped.forEach((lines, i) => {
      paintCell(x, y, colW[i]!, row.height, lines, { rtl: i !== 1 })
      x += colW[i]!
    })
    y += row.height
  }

  const dataUrl = canvas.toDataURL('image/png')
  if (!dataUrl.startsWith('data:image/png') || dataUrl.length < 800) {
    throw new Error('PNG списка оборудования получился пустым')
  }
  const blob = await dataUrlToPngBlob(dataUrl)
  if (blob.size < 1500) {
    throw new Error('PNG списка оборудования получился пустым')
  }
  return {
    filename,
    blob: blob.type === 'image/png' ? blob : new Blob([blob], { type: 'image/png' }),
    mimeType: 'image/png',
    base64: stripPngDataUrlPrefix(dataUrl),
  }
}

export interface TripPackFiles {
  /** Схемы PNG всех экранов */
  pngs: SchemeUploadFile[]
  /** Список оборудования как PNG (эквивалент Excel для GAS) */
  excel: SchemeUploadFile | null
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
  if (state) {
    screenCapture?.onProgress?.('Сборка списка оборудования (PNG)…')
    excel = await buildEquipmentListPngUploadFile(state)
  }
  return { pngs, excel }
}

/** Плоский список для локального скачивания / upload */
export function flattenTripPackFiles(pack: TripPackFiles): SchemeUploadFile[] {
  return pack.excel ? [pack.excel, ...pack.pngs] : [...pack.pngs]
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
    const result = await postSchemeForm(bridge.uploadUrl, {
      action: 'uploadSchemeImages',
      trip_id: bridge.tripId,
      upload_token: bridge.uploadToken,
      files: filePayloads,
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
): Promise<UploadTripPackResult> {
  const allFiles = flattenTripPackFiles(pack)
  if (allFiles.length === 0) {
    throw new Error('Нет файлов для отправки')
  }
  const batches = chunkFiles(allFiles, 5)
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
    const result = await uploadSchemeImagesToTrip(bridge, batch)
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
