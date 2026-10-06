import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { PitchPresetId, ScreenConfig } from '../types'
import {
  countCabinetGrid,
  gridFilledCount,
  occupiedForFixedCounts,
  occupiedWithinBounds,
  type GridCount,
} from './sketchGrid'
import { gridFromPdfVectors } from './sketchVectors'
import { cabinetLabel, syncCabinetGridFromMeters } from './cabinetGrid'
import { applyPitchPreset } from './pitchPresets'
import {
  applyStripRowMixBands,
  bandsFromBigSmallCounts,
  stripRowMixBandsFor,
} from './rowMix'

/** Что удалось прочитать из PDF-эскиза экрана */
export interface SketchReading {
  wallWidthM: number | null
  wallHeightM: number | null
  pitchPreset: PitchPresetId | null
  hangMount: boolean | null
  eventName: string | null
  /** Нижние ряды 3.9 Big, если в эскизе указан микс */
  bigRows: number | null
  /** Верхние ряды 3.9 Small */
  smallRows: number | null
  /** Колонки кубиков, посчитанные по рисунку */
  cabinetsWide: number | null
  /** Ряды кубиков, посчитанные по рисунку */
  cabinetsHigh: number | null
  /** Ячейки, которых нет на рисунке */
  emptyCabinets: string[]
  /** Откуда взята сетка */
  source: 'vector' | 'pdf-image' | 'image' | null
  /** Доли картинки 0…1: куда на файле легла найденная сетка */
  gridBounds: { left: number; top: number; right: number; bottom: number } | null
  notes: string[]
}

export interface SketchDocument extends SketchReading {
  fileName: string
  pageCount: number
  /** Кусок текста, который реально извлекли из PDF */
  textPreview: string
}

const METER_UNIT = /^(м|m)$/i
const MM_UNIT = /^(мм|mm)$/i
const CM_UNIT = /^(см|cm)$/i
const UNIT = 'мм|mm|см|cm|м|m'

function toNumber(raw: string): number {
  return Number(raw.replace(',', '.'))
}

function asMeters(value: number, unit: string | undefined): number | null {
  if (!Number.isFinite(value) || value <= 0) return null
  if (unit && MM_UNIT.test(unit)) return value / 1000
  if (unit && CM_UNIT.test(unit)) return value / 100
  if (unit && METER_UNIT.test(unit)) return value
  if (value >= 300) return value / 1000
  if (value <= 80) return value
  return null
}

function pairLooksLikePixels(width: number, height: number, unit: string | undefined): boolean {
  if (unit) return false
  if (!Number.isInteger(width) || !Number.isInteger(height)) return false
  if (width < 640 || height < 360 || width > 7680 || height > 4320) return false
  // Круглые миллиметры стены (6000×4000) не путаем с разрешением
  if (width % 100 === 0 && height % 100 === 0) return false
  return true
}

function pushNote(notes: string[], note: string) {
  if (!notes.includes(note)) notes.push(note)
}

/** Разбор текста эскиза: метры, питч, микс Big/Small, подвес, имя события */
export function parseSketchText(raw: string): SketchReading {
  const text = raw.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ')
  const notes: string[] = []
  const reading: SketchReading = {
    wallWidthM: null,
    wallHeightM: null,
    pitchPreset: null,
    hangMount: null,
    eventName: null,
    bigRows: null,
    smallRows: null,
    cabinetsWide: null,
    cabinetsHigh: null,
    emptyCabinets: [],
    source: null,
    gridBounds: null,
    notes,
  }

  const widthLabel = text.match(
    new RegExp(`(?:ширин[аы]|width|רוחב)\\s*[:=]?\\s*(\\d+(?:[.,]\\d+)?)\\s*(${UNIT})?`, 'i'),
  )
  const heightLabel = text.match(
    new RegExp(`(?:высот[аы]|height|גובה)\\s*[:=]?\\s*(\\d+(?:[.,]\\d+)?)\\s*(${UNIT})?`, 'i'),
  )
  if (widthLabel) reading.wallWidthM = asMeters(toNumber(widthLabel[1]), widthLabel[2])
  if (heightLabel) reading.wallHeightM = asMeters(toNumber(heightLabel[1]), heightLabel[2])

  if (reading.wallWidthM == null || reading.wallHeightM == null) {
    const pairRe = new RegExp(
      `(\\d+(?:[.,]\\d+)?)\\s*(${UNIT})?\\s*[x×х✕✖*]\\s*(\\d+(?:[.,]\\d+)?)\\s*(${UNIT})?`,
      'gi',
    )
    for (const match of text.matchAll(pairRe)) {
      const unit = match[2] || match[4]
      const width = toNumber(match[1])
      const height = toNumber(match[3])
      if (pairLooksLikePixels(width, height, unit)) continue
      const widthM = asMeters(width, match[2] || match[4])
      const heightM = asMeters(height, match[4] || match[2])
      if (widthM == null || heightM == null) continue
      if (widthM > 40 || heightM > 40) continue
      if (reading.wallWidthM == null) reading.wallWidthM = widthM
      if (reading.wallHeightM == null) reading.wallHeightM = heightM
      break
    }
  }

  const has39 = /3[.,]9/.test(text)
  const has29 = /2[.,]9/.test(text)
  const bigWord = /big|больш|גדול/i.test(text)
  const smallWord = /small|малень|קטן/i.test(text)
  const reshet = /reshet|решет|רשת/i.test(text)

  if (reshet) reading.pitchPreset = '3.9-reshet'
  else if (has39 && bigWord && !smallWord) reading.pitchPreset = '3.9-big'
  else if (has39 && smallWord && !bigWord) reading.pitchPreset = '3.9-small'
  else if (has39 && bigWord && smallWord) reading.pitchPreset = '3.9-big'
  else if (has29 && !has39) reading.pitchPreset = '2.9'
  else if (has39 && !has29) {
    reading.pitchPreset = '3.9-small'
    pushNote(notes, 'Питч 3.9 без Big/Small — взяты маленькие кубики 500×500.')
  } else if (has29 && has39) {
    reading.pitchPreset = bigWord ? '3.9-big' : '3.9-small'
    pushNote(notes, 'В эскизе и 2.9, и 3.9 — для схемы взят 3.9.')
  }

  const bigMatch = text.match(/(\d+)\s*(?:ряд(?:а|ов)?)?\s*(?:3[.,]9\s*)?(?:big|больш)/i)
  const smallMatch = text.match(/(\d+)\s*(?:ряд(?:а|ов)?)?\s*(?:3[.,]9\s*)?(?:small|малень)/i)
  const mixMatch = text.match(/микс[^.\n]{0,48}?(\d+)\s*\+\s*(\d+)/i)
  if (bigMatch && smallMatch) {
    reading.bigRows = Number(bigMatch[1])
    reading.smallRows = Number(smallMatch[1])
  } else if (mixMatch) {
    reading.bigRows = Number(mixMatch[1])
    reading.smallRows = Number(mixMatch[2])
    pushNote(notes, 'Микс N+M: нижние ряды Big, верхние Small.')
  }

  if (/без подвеса|на полу|floor mount/i.test(text)) reading.hangMount = false
  else if (/подвес|תלי|hang/i.test(text)) reading.hangMount = true

  const event = text.match(
    /(?:שם האירוע|название события|event name)\s*[:\-]?\s*([^\n]{2,80})/i,
  )
  if (event) reading.eventName = event[1].trim()

  if (reading.wallWidthM == null || reading.wallHeightM == null) {
    pushNote(notes, 'Не найден размер стены (например 6×4 м или ширина/высота).')
  }
  return reading
}

/** Размер стены из числа кубиков на рисунке. Квадрат — 500×500, широкий — Reshet, высокий — Big. */
export function fillReadingFromGrid(
  reading: SketchReading,
  grid: GridCount,
  source: SketchReading['source'] = null,
): void {
  const textWidth = reading.wallWidthM
  const textHeight = reading.wallHeightM
  const textSizeOk =
    textWidth != null &&
    textHeight != null &&
    textWidth >= 0.5 &&
    textHeight >= 0.5 &&
    textWidth <= 40 &&
    textHeight <= 40

  let cellWidthMm = 500
  let cellHeightMm = 500
  if (reading.pitchPreset === '3.9-big') {
    cellWidthMm = 500
    cellHeightMm = 1000
  } else if (reading.pitchPreset === '3.9-reshet') {
    cellWidthMm = 1000
    cellHeightMm = 500
  } else if (reading.pitchPreset == null) {
    if (grid.cellAspect >= 1.55) {
      reading.pitchPreset = '3.9-reshet'
      cellWidthMm = 1000
      cellHeightMm = 500
    } else if (grid.cellAspect <= 0.65) {
      reading.pitchPreset = '3.9-big'
      cellWidthMm = 500
      cellHeightMm = 1000
    } else {
      reading.pitchPreset = '3.9-small'
      pushNote(reading.notes, 'Кубики на рисунке квадратные — взят питч 3.9 small, 500×500 мм.')
    }
  } else if (reading.pitchPreset === '2.9') {
    cellWidthMm = 500
    cellHeightMm = 500
  }

  const fromGridW = (grid.cabinetsWide * cellWidthMm) / 1000
  const fromGridH = (grid.cabinetsHigh * cellHeightMm) / 1000
  const gridSizeOk = fromGridW >= 0.5 && fromGridH >= 0.5 && fromGridW <= 40 && fromGridH <= 40

  // Текст на эскизе важнее: «10×5.5 м» не затираем сеткой с подписями
  if (textSizeOk) {
    reading.wallWidthM = textWidth
    reading.wallHeightM = textHeight
  } else if (gridSizeOk) {
    reading.wallWidthM = fromGridW
    reading.wallHeightM = fromGridH
  } else {
    pushNote(
      reading.notes,
      `Сетка на рисунке ${grid.cabinetsWide}×${grid.cabinetsHigh} не похожа на стену — оставляю только маску, размер стены не меняю.`,
    )
  }

  reading.cabinetsWide = grid.cabinetsWide
  reading.cabinetsHigh = grid.cabinetsHigh
  reading.gridBounds = grid.bounds
    ? {
        left: grid.bounds.left,
        top: grid.bounds.top,
        right: grid.bounds.right,
        bottom: grid.bounds.bottom,
      }
    : reading.gridBounds ?? { left: 0, top: 0, right: 1, bottom: 1 }
  reading.emptyCabinets = []
  for (let row = 0; row < grid.cabinetsHigh; row++) {
    for (let col = 0; col < grid.cabinetsWide; col++) {
      if (!grid.occupied[row]?.[col]) {
        reading.emptyCabinets.push(cabinetLabel(row, col, grid.cabinetsHigh))
      }
    }
  }
  reading.source = source
  const filled = grid.cabinetsWide * grid.cabinetsHigh - reading.emptyCabinets.length
  const hole =
    reading.emptyCabinets.length > 0 ? `, пустых ячеек ${reading.emptyCabinets.length}` : ''
  const via =
    source === 'vector'
      ? 'Сетка совпала и в линиях PDF, и на картинке страницы.'
      : source === 'pdf-image'
        ? 'Сетка снята с картинки страницы PDF.'
        : source === 'image'
          ? 'Схема снята с картинки.'
          : ''
  if (via) pushNote(reading.notes, via)
  pushNote(reading.notes, `Сетка как на рисунке: ${grid.cabinetsWide}×${grid.cabinetsHigh}, кубиков ${filled}${hole}.`)
  reading.notes = reading.notes.filter((note) => !note.startsWith('Не найден размер'))
}

export function sketchCanBuild(reading: SketchReading): boolean {
  const metersOk =
    reading.wallWidthM != null &&
    reading.wallHeightM != null &&
    reading.wallWidthM >= 0.5 &&
    reading.wallHeightM >= 0.5 &&
    reading.wallWidthM <= 40 &&
    reading.wallHeightM <= 40
  if (metersOk) return true
  return (
    reading.cabinetsWide != null &&
    reading.cabinetsHigh != null &&
    reading.cabinetsWide >= 2 &&
    reading.cabinetsHigh >= 1 &&
    reading.cabinetsWide <= 64 &&
    reading.cabinetsHigh <= 48
  )
}

/** Подставляет размеры и питч эскиза в экран и пересчитывает сетку */
export function applySketchToScreen(screen: ScreenConfig, reading: SketchReading): ScreenConfig {
  if (!sketchCanBuild(reading)) return screen

  let wallWidthM = reading.wallWidthM
  let wallHeightM = reading.wallHeightM
  if (
    (wallWidthM == null || wallHeightM == null) &&
    reading.cabinetsWide != null &&
    reading.cabinetsHigh != null
  ) {
    let cellW = 500
    let cellH = 500
    if (reading.pitchPreset === '3.9-big') {
      cellW = 500
      cellH = 1000
    } else if (reading.pitchPreset === '3.9-reshet') {
      cellW = 1000
      cellH = 500
    }
    wallWidthM = (reading.cabinetsWide * cellW) / 1000
    wallHeightM = (reading.cabinetsHigh * cellH) / 1000
  }

  let next: ScreenConfig = {
    ...screen,
    emptyCabinets: [...(reading.emptyCabinets ?? [])],
    stripRowMixBands: [],
    stripWidths: [],
    stripHeights: [],
    stripPitchConfigs: [{ kind: 'inherit' }],
    wallWidthM: wallWidthM ?? screen.wallWidthM,
    wallHeightM: wallHeightM ?? screen.wallHeightM,
    ...(reading.hangMount != null ? { hangMount: reading.hangMount } : {}),
  }
  if (reading.pitchPreset && reading.pitchPreset !== 'custom') {
    next = applyPitchPreset(next, reading.pitchPreset)
  }
  next = syncCabinetGridFromMeters(next)
  if (
    reading.bigRows != null &&
    reading.smallRows != null &&
    reading.bigRows + reading.smallRows > 0
  ) {
    const all = stripRowMixBandsFor(next)
    all[0] = bandsFromBigSmallCounts(reading.bigRows, reading.smallRows, false)
    next = syncCabinetGridFromMeters(applyStripRowMixBands(next, all))
  }
  return next
}

interface PdfTextItem {
  str: string
  transform?: number[]
  width?: number
}

/** Склеивает куски текста PDF по строкам, без лишних пробелов между соседними символами */
function textFromPdfItems(items: unknown[]): string {
  const parts: { x: number; y: number; str: string; end: number }[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object' || !('str' in item)) continue
    const rec = item as PdfTextItem
    if (!rec.str) continue
    const x = rec.transform?.[4] ?? 0
    const y = rec.transform?.[5] ?? 0
    const width = rec.width ?? 0
    parts.push({ x, y, str: rec.str, end: x + width })
  }
  parts.sort((a, b) => (Math.abs(a.y - b.y) > 2 ? b.y - a.y : a.x - b.x))

  let out = ''
  let lastY: number | null = null
  let lastEnd = 0
  for (const part of parts) {
    if (lastY == null) out = part.str
    else if (Math.abs(part.y - lastY) > 2) out += `\n${part.str}`
    else if (part.x - lastEnd > 1.5) out += ` ${part.str}`
    else out += part.str
    lastY = part.y
    lastEnd = part.end
  }
  return out
}

function gridScore(grid: GridCount | null): number {
  const filled = gridFilledCount(grid)
  if (!grid || filled < 4) return -1
  const cells = grid.cabinetsWide * grid.cabinetsHigh
  // Подписи/хром схемы дают «сетку» 50×40 и больше — это не кубики
  if (grid.cabinetsWide > 48 || grid.cabinetsHigh > 32 || cells > 900) return -1
  if (filled / cells < 0.2) return -1
  const aspectOk = [0.5, 1, 2].some((target) => Math.abs(Math.log(grid.cellAspect / target)) < 0.28)
  return filled + (aspectOk ? 30 : 0)
}

/** Картинка страницы и вектор: берём вариант с лучшим score. */
function pickPdfGrid(
  vector: GridCount | null,
  raster: GridCount | null,
): { grid: GridCount; source: 'vector' | 'pdf-image' } | null {
  const vectorScore = gridScore(vector)
  const rasterScore = gridScore(raster)
  if (rasterScore < 0 && vectorScore < 0) return null
  if (rasterScore >= vectorScore && raster) return { grid: raster, source: 'pdf-image' }
  if (vector) return { grid: vector, source: 'vector' }
  return null
}

async function rasterGridFromPage(page: PDFPageProxy): Promise<GridCount | null> {
  if (typeof document === 'undefined') return null
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(2.8, 1600 / Math.max(base.width, base.height))
  const viewport = page.getViewport({ scale: Math.max(1, scale) })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  // pdf.js 5+: нужен canvasContext, иначе страница может остаться белой
  await page.render({ canvasContext: ctx, canvas, viewport }).promise
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return countCabinetGrid(image.data, image.width, image.height)
}

/** Рендер страниц и подсчёт кубиков: вектор PDF или картинка страницы */
async function gridFromPdf(
  doc: PDFDocumentProxy,
): Promise<{ grid: GridCount; source: 'vector' | 'pdf-image' } | null> {
  let best: { grid: GridCount; source: 'vector' | 'pdf-image' } | null = null
  const pageCount = Math.min(doc.numPages, 3)
  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i)
    const vector = await gridFromPdfVectors(page)
    const raster = await rasterGridFromPage(page)
    const picked = pickPdfGrid(vector, raster)
    if (!picked) continue
    if (!best || gridScore(picked.grid) > gridScore(best.grid)) best = picked
  }
  return best
}

function isSketchImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  return /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)
}

async function gridFromImageFile(file: File): Promise<GridCount | null> {
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') return null
  const bitmap = await createImageBitmap(file)
  const longSide = Math.max(bitmap.width, bitmap.height)
  const scale = Math.min(3, Math.max(1, 1800 / longSide))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    bitmap.close()
    return null
  }
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return countCabinetGrid(image.data, image.width, image.height)
}

/** Картинка схемы: png, jpg, webp */
export async function readSketchImage(file: File): Promise<SketchDocument> {
  const parsed = parseSketchText(file.name.replace(/[_-]+/g, ' '))
  const grid = await gridFromImageFile(file)
  if (grid) fillReadingFromGrid(parsed, grid, 'image')
  else pushNote(parsed.notes, 'На картинке не удалось найти сетку кубиков.')
  return {
    ...parsed,
    fileName: file.name,
    pageCount: 1,
    textPreview: '',
  }
}

/** Текст всех страниц PDF */
export async function readSketchPdf(file: File): Promise<SketchDocument> {
  const pdfjs = await import('pdfjs-dist')
  const workerSrc = (await import('./sketchPdfWorker')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

  const data = new Uint8Array(await file.arrayBuffer())
  const task = pdfjs.getDocument({ data })
  let timer: ReturnType<typeof setTimeout> | undefined
  const doc = await Promise.race([
    task.promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        void task.destroy()
        reject(new Error('PDF не открылся. Обновите страницу и выберите файл ещё раз.'))
      }, 12000)
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer)
  })

  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    pages.push(textFromPdfItems(content.items))
  }
  const body = pages.join('\n').trim()
  const parsed = parseSketchText(`${body}\n${file.name.replace(/[_-]+/g, ' ')}`)
  const picked = await gridFromPdf(doc)
  if (picked) fillReadingFromGrid(parsed, picked.grid, picked.source)
  if (!body && !sketchCanBuild(parsed)) {
    pushNote(parsed.notes, 'В PDF нет текста, и сетку кубиков на рисунке распознать не удалось.')
  }
  return {
    ...parsed,
    fileName: file.name,
    pageCount: doc.numPages,
    textPreview: body.slice(0, 400),
  }
}

async function rasterizeSketchFile(file: File): Promise<ImageData | null> {
  if (typeof document === 'undefined') return null
  if (isSketchImageFile(file)) {
    if (typeof createImageBitmap === 'undefined') return null
    const bitmap = await createImageBitmap(file)
    const longSide = Math.max(bitmap.width, bitmap.height)
    const scale = Math.min(2.2, Math.max(1, 1100 / longSide))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) {
      bitmap.close()
      return null
    }
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    return ctx.getImageData(0, 0, canvas.width, canvas.height)
  }

  const pdfjs = await import('pdfjs-dist')
  const workerSrc = (await import('./sketchPdfWorker')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc
  const data = new Uint8Array(await file.arrayBuffer())
  const doc = await pdfjs.getDocument({ data }).promise
  {
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(2.2, 1100 / Math.max(base.width, base.height))
    const viewport = page.getViewport({ scale: Math.max(0.7, scale) })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, canvas, viewport }).promise
    return ctx.getImageData(0, 0, canvas.width, canvas.height)
  }
}

/** Сетка, которую разметили на экране или вернули из Excel. Пустая клетка — нет кубика. */
export function sketchFromMarkedGrid(
  cols: number,
  rows: number,
  occupied: boolean[][],
  base: SketchDocument | null,
): SketchDocument {
  const sizeChanged =
    base == null || base.cabinetsWide !== cols || base.cabinetsHigh !== rows
  const reading: SketchReading = base
    ? {
        ...base,
        // Новый размер сетки — стены из числа кубиков; клик по клетке размер не меняет
        wallWidthM: sizeChanged ? null : base.wallWidthM,
        wallHeightM: sizeChanged ? null : base.wallHeightM,
        notes: base.notes.filter(
          (note) =>
            !note.startsWith('Не найден размер') &&
            !note.startsWith('В PDF нет текста') &&
            !note.startsWith('Сетка размечена'),
        ),
        emptyCabinets: [],
      }
    : parseSketchText('')
  const mask = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => occupied[row]?.[col] !== false),
  )
  fillReadingFromGrid(
    reading,
    { cabinetsWide: cols, cabinetsHigh: rows, cellAspect: 1, occupied: mask },
    base?.source ?? null,
  )
  const empty = reading.emptyCabinets.length
  pushNote(
    reading.notes,
    empty > 0
      ? `Сетка размечена: ${cols}×${rows}, пустых ${empty}.`
      : `Сетка размечена: ${cols}×${rows}, все клетки — кубики.`,
  )
  return {
    ...reading,
    fileName: base?.fileName ?? 'сетка',
    pageCount: base?.pageCount ?? 0,
    textPreview: base?.textPreview ?? '',
  }
}

/**
 * Ширина и высота заданы числом кубиков. Картинка только отмечает пустые клетки,
 * и только если там явно нет линий.
 */
export async function sketchWithCabinetCounts(
  file: File | null,
  cols: number,
  rows: number,
  base: SketchDocument | null,
): Promise<SketchDocument> {
  const reading: SketchReading = base
    ? {
        ...base,
        notes: base.notes.filter(
          (note) => !note.startsWith('Не найден размер') && !note.startsWith('В PDF нет текста'),
        ),
        emptyCabinets: [],
      }
    : parseSketchText('')
  let occupied = Array.from({ length: rows }, () => Array.from({ length: cols }, () => true))
  if (file) {
    try {
      const image = await rasterizeSketchFile(file)
      if (image) {
        occupied = occupiedForFixedCounts(image.data, image.width, image.height, cols, rows)
      }
    } catch {
      // Размер уже задан — сплошная сетка, если картинку не удалось перечитать
    }
  }
  fillReadingFromGrid(
    reading,
    { cabinetsWide: cols, cabinetsHigh: rows, cellAspect: 1, occupied },
    base?.source ?? null,
  )
  pushNote(reading.notes, `Размер задан вручную: ${cols}×${rows} кубиков.`)
  return {
    ...reading,
    fileName: base?.fileName ?? file?.name ?? 'размер вручную',
    pageCount: base?.pageCount ?? (file ? 1 : 0),
    textPreview: base?.textPreview ?? '',
  }
}

/**
 * Повторно сканирует занятость клеток внутри зафиксированной рамки на файле.
 * Возвращает маску [ряд][колонка]: true — кубик есть.
 */
export async function rescanOccupiedInBounds(
  file: File,
  cols: number,
  rows: number,
  bounds: { left: number; top: number; right: number; bottom: number },
): Promise<boolean[][]> {
  const filled = Array.from({ length: rows }, () => Array.from({ length: cols }, () => true))
  if (cols < 1 || rows < 1) return filled
  try {
    const image = await rasterizeSketchFile(file)
    if (!image) return filled
    return occupiedWithinBounds(image.data, image.width, image.height, cols, rows, bounds)
  } catch {
    return filled
  }
}

/** PDF или картинка. Для PDF сначала вектор, иначе картинка страницы. */
export async function readSketchFile(file: File): Promise<SketchDocument> {
  if (isSketchImageFile(file)) return readSketchImage(file)
  return readSketchPdf(file)
}
