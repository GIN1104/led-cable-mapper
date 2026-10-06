import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { cabinetLabel } from '../lib/cabinetGrid'
import {
  readSketchFile,
  rescanOccupiedInBounds,
  sketchCanBuild,
  sketchFromMarkedGrid,
  type SketchDocument,
} from '../lib/sketchPdf'
import { clearSketchPdf, loadSketchPdf, saveSketchPdf } from '../lib/sketchPdfStore'

interface SketchPdfImportProps {
  onApply: (sketch: SketchDocument) => void
  /** false после хард-ресет: не поднимать PDF из памяти */
  restorePdf?: boolean
}

function maskFromSketch(sketch: SketchDocument): boolean[][] | null {
  const cols = sketch.cabinetsWide
  const rows = sketch.cabinetsHigh
  if (!cols || !rows) return null
  const empty = new Set(sketch.emptyCabinets)
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => !empty.has(cabinetLabel(row, col, rows))),
  )
}

function resizeMask(prev: boolean[][] | null, cols: number, rows: number): boolean[][] {
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => prev?.[row]?.[col] !== false),
  )
}

function formatSize(sketch: SketchDocument): string {
  if (sketch.wallWidthM == null || sketch.wallHeightM == null) return 'размер не найден'
  const w = Number.isInteger(sketch.wallWidthM) ? String(sketch.wallWidthM) : sketch.wallWidthM.toFixed(1)
  const h = Number.isInteger(sketch.wallHeightM) ? String(sketch.wallHeightM) : sketch.wallHeightM.toFixed(1)
  return `${w}×${h} м`
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.round(value)))
}

const btnClass =
  'rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50'

const ScaleRow = ({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (next: number) => void
}) => (
  <label className="flex min-w-[10rem] flex-1 items-center gap-2 text-[11px] text-slate-600">
    <span className="shrink-0 font-medium">{label}</span>
    <input
      type="range"
      min={40}
      max={100}
      step={5}
      value={Math.round(value * 100)}
      onChange={(event) => onChange(Number(event.target.value) / 100)}
      className="min-w-0 flex-1"
    />
    <span className="w-8 shrink-0 tabular-nums text-slate-500">{Math.round(value * 100)}%</span>
  </label>
)

/** Рамка с номерами колонок сверху и рядов слева */
function AxisFrame({
  cols,
  rows,
  widthPct,
  children,
}: {
  cols: number
  rows: number
  widthPct: string
  children: ReactNode
}) {
  const axisFs = `clamp(7px, ${90 / Math.max(cols, rows)}px, 11px)`
  return (
    <div className="flex w-full justify-center overflow-x-hidden">
      <div className="flex max-w-full" style={{ width: widthPct }}>
        <div className="flex w-5 shrink-0 flex-col sm:w-6">
          <div className="h-5 shrink-0 border-b border-r border-slate-200 bg-slate-50 sm:h-6" />
          <div className="flex min-h-0 flex-1 flex-col">
            {Array.from({ length: rows }, (_, row) => (
              <div
                key={`r-${row}`}
                className="flex min-h-0 flex-1 items-center justify-center border-r border-slate-200 bg-slate-50 font-semibold tabular-nums text-slate-600"
                style={{ fontSize: axisFs }}
                title={`Ряд ${row + 1}`}
              >
                {row + 1}
              </div>
            ))}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="grid h-5 border-b border-slate-200 bg-slate-50 sm:h-6"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: cols }, (_, col) => (
              <div
                key={`c-${col}`}
                className="flex items-center justify-center font-semibold tabular-nums text-slate-600"
                style={{ fontSize: axisFs }}
                title={`Колонка ${col + 1}`}
              >
                {col + 1}
              </div>
            ))}
          </div>
          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </div>
  )
}

type GridBounds = { left: number; top: number; right: number; bottom: number }

const FULL_BOUNDS: GridBounds = { left: 0, top: 0, right: 1, bottom: 1 }

function resolveBounds(bounds: GridBounds | null | undefined): GridBounds {
  if (
    bounds &&
    bounds.right > bounds.left + 0.02 &&
    bounds.bottom > bounds.top + 0.02
  ) {
    return bounds
  }
  return FULL_BOUNDS
}

async function rasterizeFilePage(file: File): Promise<HTMLCanvasElement> {
  const asImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)
  if (asImage) {
    const bitmap = await createImageBitmap(file)
    const longSide = Math.max(bitmap.width, bitmap.height)
    const scale = Math.min(2, Math.max(1, 1400 / longSide))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      throw new Error('Не удалось нарисовать картинку')
    }
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    return canvas
  }

  const pdfjs = await import('pdfjs-dist')
  const workerSrc = (await import('../lib/sketchPdfWorker')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc
  const data = new Uint8Array(await file.arrayBuffer())
  const doc = await pdfjs.getDocument({ data }).promise
  const page = await doc.getPage(1)
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(2.2, 1400 / Math.max(base.width, base.height))
  const viewport = page.getViewport({ scale: Math.max(0.9, scale) })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Не удалось нарисовать PDF')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, canvas, viewport }).promise
  return canvas
}

function clampBounds(b: GridBounds): GridBounds {
  const minSpan = 0.05
  let left = Math.max(0, Math.min(1, b.left))
  let top = Math.max(0, Math.min(1, b.top))
  let right = Math.max(0, Math.min(1, b.right))
  let bottom = Math.max(0, Math.min(1, b.bottom))
  if (right - left < minSpan) right = Math.min(1, left + minSpan)
  if (bottom - top < minSpan) bottom = Math.min(1, top + minSpan)
  return { left, top, right, bottom }
}

/**
 * Рамка так, чтобы ячейки были квадратными в пикселях превью.
 * contentW/H — размер картинки на экране (или натуральный, с тем же соотношением сторон).
 */
function boundsWithSquareCells(
  b: GridBounds,
  cols: number,
  rows: number,
  contentW: number,
  contentH: number,
  anchor: 'center' | 'top-left' = 'center',
): GridBounds {
  if (cols < 1 || rows < 1) return clampBounds(b)
  const W = Math.max(1, contentW)
  const H = Math.max(1, contentH)
  let { left, top, right, bottom } = clampBounds(b)
  const boxW = (right - left) * W
  const boxH = (bottom - top) * H
  let cell = Math.min(boxW / cols, boxH / rows)
  if (!(cell > 0)) cell = Math.min(W / cols, H / rows) * 0.5
  return squareBoundsFromCell(left, top, cell, cols, rows, W, H, anchor, (left + right) / 2, (top + bottom) / 2)
}

/** Квадратные ячейки от размера клетки в пикселях */
function squareBoundsFromCell(
  left: number,
  top: number,
  cellPx: number,
  cols: number,
  rows: number,
  contentW: number,
  contentH: number,
  anchor: 'center' | 'top-left' = 'top-left',
  midX?: number,
  midY?: number,
): GridBounds {
  const W = Math.max(1, contentW)
  const H = Math.max(1, contentH)
  let c = Math.max(4, cellPx)
  let L = left
  let T = top
  if (anchor === 'center' && midX != null && midY != null) {
    L = midX - (c * cols) / W / 2
    T = midY - (c * rows) / H / 2
  }
  let right = L + (c * cols) / W
  let bottom = T + (c * rows) / H
  if (right > 1) {
    c = ((1 - Math.max(0, L)) * W) / cols
    if (anchor === 'center' && midX != null) L = midX - (c * cols) / W / 2
    right = L + (c * cols) / W
    bottom = T + (c * rows) / H
  }
  if (bottom > 1) {
    c = ((1 - Math.max(0, T)) * H) / rows
    if (anchor === 'center' && midY != null) T = midY - (c * rows) / H / 2
    right = L + (c * cols) / W
    bottom = T + (c * rows) / H
  }
  if (L < 0) {
    right -= L
    L = 0
  }
  if (T < 0) {
    bottom -= T
    T = 0
  }
  if (right > 1) right = 1
  if (bottom > 1) bottom = 1
  return clampBounds({ left: L, top: T, right, bottom })
}

function initOverlayBounds(
  sketch: SketchDocument,
  cols: number,
  rows: number,
  contentW: number,
  contentH: number,
): GridBounds {
  return boundsWithSquareCells(resolveBounds(sketch.gridBounds), cols, rows, contentW, contentH)
}

/** Превью без сетки — сетку рисуем интерактивно поверх */
async function previewBaseFromFile(file: File): Promise<{ url: string; width: number; height: number }> {
  const page = await rasterizeFilePage(file)
  const blob = await new Promise<Blob | null>((resolve) => page.toBlob(resolve, 'image/png'))
  if (!blob) {
    return { url: URL.createObjectURL(file), width: page.width, height: page.height }
  }
  return { url: URL.createObjectURL(blob), width: page.width, height: page.height }
}

type OverlayDragMode = 'move' | 'resize-br' | 'resize-r' | 'resize-b'

function AdaptiveGridOverlay({
  cols,
  rows,
  bounds,
  mask,
  locked,
  disabled,
  onChange,
  onCommit,
  onPaintBegin,
  onPaintStroke,
}: {
  cols: number
  rows: number
  bounds: GridBounds
  mask: boolean[][] | null
  locked: boolean
  disabled?: boolean
  onChange: (next: GridBounds) => void
  onCommit: (next: GridBounds) => void
  onPaintBegin?: (row: number, col: number) => void
  onPaintStroke?: (row: number, col: number) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const boundsRef = useRef(bounds)
  boundsRef.current = bounds
  const dragRef = useRef<{
    mode: OverlayDragMode
    startX: number
    startY: number
    start: GridBounds
  } | null>(null)

  const finishDrag = () => {
    const hadDrag = dragRef.current != null
    dragRef.current = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', finishDrag)
    if (hadDrag) onCommit(boundsRef.current)
  }

  const onPointerMove = (event: PointerEvent) => {
    const drag = dragRef.current
    const host = hostRef.current
    if (!drag || !host) return
    const rect = host.getBoundingClientRect()
    if (rect.width < 8 || rect.height < 8) return
    const W = rect.width
    const H = rect.height
    const dx = (event.clientX - drag.startX) / W
    const dy = (event.clientY - drag.startY) / H
    const s = drag.start

    if (drag.mode === 'move') {
      const w = s.right - s.left
      const h = s.bottom - s.top
      let left = s.left + dx
      let top = s.top + dy
      left = Math.max(0, Math.min(1 - w, left))
      top = Math.max(0, Math.min(1 - h, top))
      onChange(clampBounds({ left, top, right: left + w, bottom: top + h }))
      return
    }

    const startCell = Math.min(((s.right - s.left) * W) / cols, ((s.bottom - s.top) * H) / rows)
    let cellPx = startCell
    if (drag.mode === 'resize-r') {
      cellPx = ((s.right - s.left + dx) * W) / cols
    } else if (drag.mode === 'resize-b') {
      cellPx = ((s.bottom - s.top + dy) * H) / rows
    } else {
      const fromW = ((s.right - s.left + dx) * W) / cols
      const fromH = ((s.bottom - s.top + dy) * H) / rows
      cellPx = Math.abs(fromW - startCell) >= Math.abs(fromH - startCell) ? fromW : fromH
    }
    onChange(squareBoundsFromCell(s.left, s.top, cellPx, cols, rows, W, H, 'top-left'))
  }

  const startDrag = (mode: OverlayDragMode) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || locked) return
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      start: bounds,
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', finishDrag)
  }

  useEffect(() => () => finishDrag(), [])

  const left = bounds.left * 100
  const top = bounds.top * 100
  const width = (bounds.right - bounds.left) * 100
  const height = (bounds.bottom - bounds.top) * 100
  const axisFs = `clamp(7px, ${70 / Math.max(cols, rows)}px, 12px)`

  return (
    <div ref={hostRef} className="pointer-events-none absolute inset-0">
      <div
        className="pointer-events-auto absolute touch-none"
        style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
      >
        {/* Цифры только после фиксации — слева от 1-й колонки и сверху над 1-м рядом */}
        {locked && (
          <>
            <div
              className="pointer-events-none absolute bottom-full left-0 right-0 mb-0.5 grid"
              style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
            >
              {Array.from({ length: cols }, (_, col) => (
                <div
                  key={`oc-${col}`}
                  className="flex items-center justify-center font-bold tabular-nums text-amber-800 drop-shadow-[0_0_2px_#fff]"
                  style={{ fontSize: axisFs }}
                >
                  {col + 1}
                </div>
              ))}
            </div>
            <div className="pointer-events-none absolute bottom-0 right-full top-0 mr-0.5 flex w-4 flex-col sm:w-5">
              {Array.from({ length: rows }, (_, row) => (
                <div
                  key={`or-${row}`}
                  className="flex min-h-0 flex-1 items-center justify-center font-bold tabular-nums text-amber-800 drop-shadow-[0_0_2px_#fff]"
                  style={{ fontSize: axisFs }}
                >
                  {row + 1}
                </div>
              ))}
            </div>
          </>
        )}

        <div
          className={`absolute inset-0 rounded-sm border-2 border-amber-500 bg-amber-500/5 ${
            locked ? 'cursor-default' : 'cursor-move'
          }`}
          onPointerDown={locked ? undefined : startDrag('move')}
          title={
            locked
              ? 'Ctrl/⌘ + тянуть — отметить пустые клетки'
              : 'Перетащите, чтобы сдвинуть сетку'
          }
        >
          <div
            className="absolute inset-0 grid"
            style={{
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
            }}
          >
            {Array.from({ length: rows }, (_, row) =>
              Array.from({ length: cols }, (_, col) => {
                const on = mask?.[row]?.[col] !== false
                return (
                  <div
                    key={`${row}-${col}`}
                    className={`border border-amber-600/75 ${
                      on ? 'bg-transparent' : 'bg-slate-400/35'
                    } ${locked && !disabled ? 'cursor-cell' : ''}`}
                    onPointerDown={(event) => {
                      if (!locked || disabled || !onPaintBegin) return
                      if (!(event.ctrlKey || event.metaKey)) return
                      event.preventDefault()
                      event.stopPropagation()
                      onPaintBegin(row, col)
                    }}
                    onPointerEnter={() => {
                      if (!locked || disabled || !onPaintStroke) return
                      onPaintStroke(row, col)
                    }}
                  />
                )
              }),
            )}
          </div>
        </div>

        {!locked && (
          <>
            <div
              className="absolute -bottom-1.5 left-1/2 h-3 w-8 -translate-x-1/2 cursor-ns-resize rounded-full bg-amber-600/90"
              onPointerDown={startDrag('resize-b')}
              title="Тянуть вверх/вниз"
            />
            <div
              className="absolute -right-1.5 top-1/2 h-8 w-3 -translate-y-1/2 cursor-ew-resize rounded-full bg-amber-600/90"
              onPointerDown={startDrag('resize-r')}
              title="Тянуть влево/вправо"
            />
            <div
              className="absolute -bottom-1 -right-1 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-white bg-amber-600 shadow"
              onPointerDown={startDrag('resize-br')}
              title="Тянуть по диагонали"
            />
          </>
        )}
      </div>
    </div>
  )
}

export default function SketchPdfImport({ onApply, restorePdf = true }: SketchPdfImportProps) {
  const [sketch, setSketch] = useState<SketchDocument | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [kept, setKept] = useState(false)
  const [colsText, setColsText] = useState('')
  const [rowsText, setRowsText] = useState('')
  const [mask, setMask] = useState<boolean[][] | null>(null)
  const [fileScale, setFileScale] = useState(1)
  const [schemeScale, setSchemeScale] = useState(1)
  const [overlayBounds, setOverlayBounds] = useState<GridBounds>(FULL_BOUNDS)
  const [gridLocked, setGridLocked] = useState(false)
  const initialBoundsRef = useRef<GridBounds>(FULL_BOUNDS)
  const previewSizeRef = useRef({ w: 1, h: 1 })
  const readGen = useRef(0)
  const sourceFileRef = useRef<File | null>(null)
  const pdfInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const resetLocal = () => {
    sourceFileRef.current = null
    setSketch(null)
    setMask(null)
    setColsText('')
    setRowsText('')
    setFileName(null)
    setError(null)
    setKept(false)
    setBusy(false)
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setOverlayBounds(FULL_BOUNDS)
    setGridLocked(false)
    initialBoundsRef.current = FULL_BOUNDS
    previewSizeRef.current = { w: 1, h: 1 }
    if (pdfInputRef.current) pdfInputRef.current.value = ''
    if (imageInputRef.current) imageInputRef.current.value = ''
  }

  const clearSketch = async () => {
    readGen.current += 1
    resetLocal()
    try {
      await clearSketchPdf()
    } catch {
      /* IndexedDB мог быть недоступен — локально уже чисто */
    }
  }

  const refreshPreview = async (file: File, gen: number) => {
    try {
      const preview = await previewBaseFromFile(file)
      if (readGen.current !== gen) {
        URL.revokeObjectURL(preview.url)
        return
      }
      previewSizeRef.current = { w: preview.width, h: preview.height }
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return preview.url
      })
    } catch {
      /* превью без разметки лучше, чем ничего */
    }
  }

  const squareBounds = (bounds: GridBounds, colsN: number, rowsN: number, anchor: 'center' | 'top-left' = 'center') =>
    boundsWithSquareCells(
      bounds,
      colsN,
      rowsN,
      previewSizeRef.current.w,
      previewSizeRef.current.h,
      anchor,
    )

  const applyOverlayBounds = (bounds: GridBounds, commitSketch: boolean) => {
    const b = clampBounds(bounds)
    setOverlayBounds(b)
    setSketch((prev) => {
      if (!prev) return prev
      const next = { ...prev, gridBounds: b }
      if (commitSketch && sketchCanBuild(next)) onApply(next)
      return next
    })
  }

  const commitMask = (
    nextMask: boolean[][],
    cols: number,
    rows: number,
    base: SketchDocument | null,
    options?: { keepLocked?: boolean; bounds?: GridBounds },
  ) => {
    const next = sketchFromMarkedGrid(cols, rows, nextMask, base)
    const bounds = options?.bounds
      ? clampBounds(options.bounds)
      : squareBounds(resolveBounds(next.gridBounds ?? base?.gridBounds), cols, rows)
    next.gridBounds = bounds
    setOverlayBounds(bounds)
    if (!options?.keepLocked) {
      initialBoundsRef.current = bounds
      setGridLocked(false)
    }
    setMask(nextMask)
    setColsText(String(cols))
    setRowsText(String(rows))
    setSketch(next)
    setError(null)
    if (sketchCanBuild(next)) onApply(next)
  }

  const lockAndRescan = async () => {
    const colsN = Number(colsText)
    const rowsN = Number(rowsText)
    if (!mask || colsN < 1 || rowsN < 1 || mask.length !== rowsN || gridLocked || busy) return
    const squared = squareBounds(overlayBounds, colsN, rowsN)
    applyOverlayBounds(squared, false)
    setGridLocked(true)
    const file = sourceFileRef.current
    if (!file) {
      if (sketch && sketchCanBuild({ ...sketch, gridBounds: squared })) {
        onApply({ ...sketch, gridBounds: squared })
      }
      return
    }
    const gen = ++readGen.current
    setBusy(true)
    setError(null)
    try {
      const occupied = await rescanOccupiedInBounds(file, colsN, rowsN, squared)
      if (readGen.current !== gen) return
      const emptyCount = occupied.flat().filter((cell) => !cell).length
      const base = sketch ? { ...sketch, gridBounds: squared } : null
      commitMask(occupied, colsN, rowsN, base, { keepLocked: true, bounds: squared })
      if (emptyCount === 0) {
        setError(
          'Пустых клеток в рамке не видно — проверьте, что рамка точно по кубикам. Пустые можно отметить кликом по схеме ниже.',
        )
      } else {
        setError(null)
      }
    } catch (err) {
      if (readGen.current !== gen) return
      setError(err instanceof Error ? err.message : 'Не удалось пересканировать сетку')
    } finally {
      if (readGen.current === gen) setBusy(false)
    }
  }

  const readFile = async (file: File, persist: boolean) => {
    const gen = ++readGen.current
    sourceFileRef.current = file
    setFileName(file.name)
    setBusy(true)
    setError(null)
    setSketch(null)
    setMask(null)
    setGridLocked(false)
    try {
      const next = await readSketchFile(file)
      if (readGen.current !== gen) return
      const cw = next.cabinetsWide ?? 0
      const ch = next.cabinetsHigh ?? 0
      if (!next.gridBounds && cw && ch) {
        next.gridBounds = { ...FULL_BOUNDS }
      }
      const nextMask = maskFromSketch(next)
      setSketch(next)
      setMask(nextMask)
      if (next.cabinetsWide) setColsText(String(next.cabinetsWide))
      if (next.cabinetsHigh) setRowsText(String(next.cabinetsHigh))
      await refreshPreview(file, gen)
      if (readGen.current !== gen) return
      if (cw >= 1 && ch >= 1) {
        const bounds = initOverlayBounds(
          next,
          cw,
          ch,
          previewSizeRef.current.w,
          previewSizeRef.current.h,
        )
        next.gridBounds = bounds
        setOverlayBounds(bounds)
        initialBoundsRef.current = bounds
        setSketch({ ...next })
      } else {
        const bounds = resolveBounds(next.gridBounds)
        setOverlayBounds(bounds)
        initialBoundsRef.current = bounds
      }
      if (persist) {
        if (sketchCanBuild(next)) {
          onApply(next)
        } else {
          setError(
            'Размер стены или сетку из файла не удалось взять — схемы не перестроены. Задайте размер сетки вручную или загрузите другой эскиз.',
          )
        }
        try {
          await saveSketchPdf(file)
          if (readGen.current === gen) setKept(true)
        } catch {
          if (readGen.current === gen) setKept(false)
        }
      } else if (readGen.current === gen) {
        setKept(true)
      }
    } catch (err) {
      if (readGen.current !== gen) return
      setSketch(null)
      setMask(null)
      setError(err instanceof Error ? err.message : 'Не удалось прочитать файл')
    } finally {
      if (readGen.current === gen) setBusy(false)
    }
  }

  useEffect(() => {
    if (!restorePdf) return
    let cancel = false
    void (async () => {
      const file = await loadSketchPdf()
      if (cancel || !file) return
      await readFile(file, false)
    })()
    return () => {
      cancel = true
      readGen.current += 1
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restorePdf])

  const onFile = async (file: File | undefined) => {
    if (!file) return
    const image = file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)
    const pdf =
      file.type === 'application/pdf' ||
      file.type === 'application/x-pdf' ||
      file.name.toLowerCase().endsWith('.pdf')
    if (file.type && !image && !pdf) {
      setError('Нужен PDF или картинка (png, jpg, webp).')
      return
    }
    await readFile(file, true)
  }

  const applyGridSize = () => {
    const cols = clampInt(Number(colsText), 1, 64)
    const rows = clampInt(Number(rowsText), 1, 48)
    const nextMask = resizeMask(mask, cols, rows)
    commitMask(nextMask, cols, rows, sketch)
  }

  const toggleCell = (row: number, col: number) => {
    if (!mask || busy) return
    const rowsN = mask.length
    const colsN = mask[0]?.length ?? 0
    if (rowsN < 1 || colsN < 1) return
    const nextMask = mask.map((line) => [...line])
    nextMask[row]![col] = !nextMask[row]![col]
    commitMask(nextMask, colsN, rowsN, sketch, {
      keepLocked: gridLocked,
      bounds: gridLocked ? overlayBounds : undefined,
    })
  }

  /** Ctrl/⌘ + протянуть мышью — красить много клеток одним жестом */
  const paintRef = useRef<{ value: boolean; draft: boolean[][] } | null>(null)
  const [draftMask, setDraftMask] = useState<boolean[][] | null>(null)
  const paintCommitRef = useRef({
    sketch,
    gridLocked,
    overlayBounds,
    busy,
  })
  paintCommitRef.current = { sketch, gridLocked, overlayBounds, busy }

  const beginPaint = (row: number, col: number) => {
    if (!mask || busy) return
    const value = !mask[row]![col]
    const draft = mask.map((line) => [...line])
    draft[row]![col] = value
    paintRef.current = { value, draft }
    setDraftMask(draft.map((line) => [...line]))
  }

  const strokePaint = (row: number, col: number) => {
    const stroke = paintRef.current
    if (!stroke) return
    if (stroke.draft[row]?.[col] === stroke.value) return
    stroke.draft[row]![col] = stroke.value
    setDraftMask(stroke.draft.map((line) => [...line]))
  }

  const endPaint = () => {
    const stroke = paintRef.current
    if (!stroke) return
    paintRef.current = null
    const draft = stroke.draft
    const rowsN = draft.length
    const colsN = draft[0]?.length ?? 0
    setDraftMask(null)
    if (rowsN < 1 || colsN < 1) return
    const ctx = paintCommitRef.current
    commitMask(draft, colsN, rowsN, ctx.sketch, {
      keepLocked: ctx.gridLocked,
      bounds: ctx.gridLocked ? ctx.overlayBounds : undefined,
    })
  }
  const endPaintRef = useRef(endPaint)
  endPaintRef.current = endPaint

  useEffect(() => {
    const onUp = () => endPaintRef.current()
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [])

  const cols = Number(colsText)
  const rows = Number(rowsText)
  const canBuild = sketch != null && sketchCanBuild(sketch)
  const hasFile = sketch != null || previewUrl != null || kept || fileName != null
  const fileWidthPct = `${Math.round(fileScale * 100)}%`
  const schemeWidthPct = `${Math.round(schemeScale * 100)}%`
  const showGrid = mask != null && cols > 0 && rows > 0 && mask.length === rows
  const viewMask = draftMask ?? mask

  return (
    <section
      className={`no-print shrink-0 border-b px-4 py-3 sm:px-6 ${
        dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-slate-50'
      }`}
      onDragOver={(event) => {
        event.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragOver(false)
        void onFile(event.dataTransfer.files?.[0])
      }}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-slate-900">Эскиз экрана</p>
          <input
            ref={pdfInputRef}
            type="file"
            accept=".pdf,application/pdf,application/x-pdf"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              void onFile(file)
            }}
          />
          <input
            ref={imageInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              void onFile(file)
            }}
          />
          <button type="button" className={btnClass} onClick={() => pdfInputRef.current?.click()}>
            {busy ? 'Чтение…' : sketch ? 'Другой PDF' : 'Загрузить PDF'}
          </button>
          <button type="button" className={btnClass} onClick={() => imageInputRef.current?.click()}>
            {busy ? 'Чтение…' : 'Картинка'}
          </button>
          <button
            type="button"
            disabled={!canBuild || busy}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            onClick={() => {
              if (sketch && sketchCanBuild(sketch)) onApply(sketch)
            }}
          >
            Построить схемы
          </button>
          {hasFile && (
            <button
              type="button"
              disabled={busy}
              className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              title="Убрать эскиз из проекта и продолжить без него"
              onClick={() => {
                void clearSketch()
              }}
            >
              Удалить файл
            </button>
          )}
        </div>

        {(previewUrl || mask) && (
          <div className="flex flex-wrap items-end gap-2 rounded border border-slate-200 bg-white px-2 py-2">
            <label className="flex items-center gap-1 text-[11px] text-slate-600">
              Колонки
              <input
                type="number"
                min={1}
                max={64}
                value={colsText}
                disabled={busy || gridLocked}
                onChange={(event) => setColsText(event.target.value)}
                className="w-14 rounded border border-slate-300 px-1.5 py-1 text-xs"
              />
            </label>
            <label className="flex items-center gap-1 text-[11px] text-slate-600">
              Ряды
              <input
                type="number"
                min={1}
                max={48}
                value={rowsText}
                disabled={busy || gridLocked}
                onChange={(event) => setRowsText(event.target.value)}
                className="w-14 rounded border border-slate-300 px-1.5 py-1 text-xs"
              />
            </label>
            <button
              type="button"
              disabled={busy || gridLocked || !Number(colsText) || !Number(rowsText)}
              className={btnClass}
              onClick={applyGridSize}
            >
              Применить размер сетки
            </button>
            <button
              type="button"
              disabled={busy || !showGrid || gridLocked}
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => {
                void lockAndRescan()
              }}
            >
              {busy && gridLocked ? 'Сканирую…' : 'Зафиксировать'}
            </button>
            <button
              type="button"
              disabled={busy || !showGrid}
              className={btnClass}
              onClick={() => {
                setGridLocked(false)
                applyOverlayBounds(squareBounds(initialBoundsRef.current, cols, rows), false)
              }}
            >
              Начать заново
            </button>
            <p className="text-[11px] text-slate-500">
              {gridLocked
                ? 'Сетка зафиксирована. Пустые: клик или Ctrl/⌘ + протянуть по схеме (и по сетке на файле).'
                : 'Ячейки квадратные. Подгоните рамку, затем «Зафиксировать». Пустые удобно красить Ctrl+мышью по схеме.'}
            </p>
          </div>
        )}

        {(previewUrl || showGrid) && (
          <div className="flex w-full flex-col gap-3 overflow-x-hidden">
            {previewUrl && (
              <div className="overflow-x-hidden rounded border border-slate-200 bg-white">
                <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-2 py-1.5">
                  <p className="text-[11px] font-medium text-slate-600">Загруженный файл</p>
                  <ScaleRow label="Масштаб файла" value={fileScale} onChange={setFileScale} />
                </div>
                <div className="flex w-full justify-center overflow-x-hidden p-2">
                  <div className="relative inline-block max-w-full" style={{ width: fileWidthPct }}>
                    <img
                      src={previewUrl}
                      alt={fileName ?? 'Эскиз'}
                      className="block h-auto w-full"
                      draggable={false}
                    />
                    {showGrid && (
                      <AdaptiveGridOverlay
                        cols={cols}
                        rows={rows}
                        bounds={overlayBounds}
                        mask={viewMask}
                        locked={gridLocked}
                        disabled={busy}
                        onChange={(b) => applyOverlayBounds(b, false)}
                        onCommit={(b) => applyOverlayBounds(b, true)}
                        onPaintBegin={beginPaint}
                        onPaintStroke={strokePaint}
                      />
                    )}
                  </div>
                </div>
              </div>
            )}

            {showGrid && viewMask && (
              <div className="overflow-x-hidden rounded border border-slate-200 bg-white">
                <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-2 py-1.5">
                  <p className="text-[11px] font-medium text-slate-600">
                    Схема сетки {cols}×{rows}
                  </p>
                  <ScaleRow label="Масштаб схемы" value={schemeScale} onChange={setSchemeScale} />
                </div>
                <div className="p-2">
                  <p className="mb-1 text-[11px] text-slate-500">
                    Клик — пустая / вернуть. Ctrl (⌘) + протянуть мышью — сразу много клеток.
                  </p>
                  <AxisFrame cols={cols} rows={rows} widthPct={schemeWidthPct}>
                    <div
                      className="grid w-full touch-none gap-px bg-slate-300 select-none"
                      style={{
                        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                      }}
                      onContextMenu={(event) => event.preventDefault()}
                    >
                      {viewMask.map((line, row) =>
                        line.map((on, col) => {
                          const label = cabinetLabel(row, col, rows)
                          return (
                            <button
                              key={`${row}-${col}`}
                              type="button"
                              title={
                                on
                                  ? `${label} — пустая (Ctrl+тянуть — несколько)`
                                  : `пусто — вернуть ${label}`
                              }
                              disabled={busy}
                              onClick={(event) => {
                                if (event.ctrlKey || event.metaKey) return
                                if (paintRef.current) return
                                toggleCell(row, col)
                              }}
                              onPointerDown={(event) => {
                                if (busy) return
                                if (!(event.ctrlKey || event.metaKey)) return
                                event.preventDefault()
                                event.currentTarget.setPointerCapture(event.pointerId)
                                beginPaint(row, col)
                              }}
                              onPointerEnter={() => {
                                if (paintRef.current) strokePaint(row, col)
                              }}
                              className={`aspect-square flex min-w-0 items-center justify-center overflow-hidden font-medium leading-none transition ${
                                on
                                  ? 'bg-blue-100 text-blue-950 hover:bg-blue-200'
                                  : 'bg-white text-slate-300 hover:bg-slate-50'
                              }`}
                              style={{ fontSize: `clamp(5px, ${2.2 / cols}em, 11px)` }}
                            >
                              {on ? label : ''}
                            </button>
                          )
                        }),
                      )}
                    </div>
                  </AxisFrame>
                </div>
              </div>
            )}
          </div>
        )}

        {sketch && (
          <div className="space-y-1 text-xs text-slate-700">
            <p>
              <span className="font-medium">{sketch.fileName}</span>
              {' · '}
              {sketch.pageCount} стр. · {formatSize(sketch)}
              {sketch.cabinetsWide != null && sketch.cabinetsHigh != null
                ? ` · сетка ${sketch.cabinetsWide}×${sketch.cabinetsHigh}${
                    sketch.emptyCabinets.length ? `, без ${sketch.emptyCabinets.length}` : ''
                  }`
                : ''}
              {sketch.pitchPreset ? ` · ${sketch.pitchPreset}` : ''}
              {sketch.bigRows != null && sketch.smallRows != null
                ? ` · микс ${sketch.bigRows} Big + ${sketch.smallRows} Small`
                : ''}
              {sketch.hangMount === true ? ' · подвес' : ''}
              {sketch.hangMount === false ? ' · без подвеса' : ''}
            </p>
            {sketch.eventName && <p>Событие: {sketch.eventName}</p>}
            {kept && <p className="text-slate-500">PDF лежит в памяти этого браузера вместе с проектом.</p>}
            {sketch.notes.map((note) => (
              <p key={note} className="text-amber-800">
                {note}
              </p>
            ))}
            {!canBuild && sketch.textPreview && (
              <p className="text-slate-500">Прочитано: {sketch.textPreview}</p>
            )}
          </div>
        )}
        {busy && (
          <p className="text-xs font-medium text-slate-700">
            Считаю кубики на рисунке {fileName ?? 'PDF'}…
          </p>
        )}
        {error && <p className="text-xs text-red-700">{error}</p>}
        {!sketch && !error && !busy && (
          <p className="text-xs text-slate-500">
            Загрузите PDF или картинку — схемы Data/Power построятся сами. Или работайте без эскиза.
          </p>
        )}
      </div>
    </section>
  )
}
