import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  ChainStartEdge,
  ControllerModel,
  PitchPresetId,
  PowerFeedMode,
  RefreshRate,
  RoutingResult,
} from '../types'
import {
  edgeToDirection,
  normalizeStripWidths,
  sameStripCol,
  stripColumnRanges,
  stripGapsBeforeCol,
} from '../lib/cabinetGrid'
import { COLORS } from '../lib/constants'
import { inferDataChainStart } from '../lib/dataRouting'
import {
  capturePanelPng,
  downloadDataUrl,
  panelExportFilename,
  type PanelPrintInfo,
  printPanelPng,
  sharePanelViaWhatsApp,
} from '../lib/panelExport'
import { CUSTOM_PRESET_LABEL, getPitchPreset } from '../lib/pitchPresets'
import { getPowerTrunkCabinet, inferPowerLineStart } from '../lib/powerRouting'
import {
  backupLineColor,
  type LineColorMode,
} from '../lib/lineColors'
import {
  computeLineColorMap,
  lineColorFromMap,
  paletteSwatches,
} from '../lib/lineColorAssignment'
import { nextDualVxLocalNumber, previewDualVxLineLabels } from '../lib/dualVxRouting'

export type GridVisualizationMode = 'data' | 'power'
export type ManualEditMode = 'assign' | 'start' | 'empty'

interface GridVisualizationProps {
  result: RoutingResult
  wide: number
  high: number
  mode: GridVisualizationMode
  /** Имя экрана — для имени файла data-ports-/power-lines-*.png */
  screenName?: string
  /** Физический размер стены — для Print screen info */
  wallWidthM?: number
  wallHeightM?: number
  controllerModel?: ControllerModel
  refreshRate?: RefreshRate
  manualMode?: boolean
  onManualModeChange?: (enabled: boolean) => void
  emptyCabinets?: string[]
  emptyPaintMode?: boolean
  onToggleEmpty?: (label: string) => void
  manualAssignments?: Record<string, number>
  /** Упорядоченные цепочки (порядок кликов) — для undo последнего кабинета линии */
  chainOrder?: Record<number, string[]>
  startPoints?: Record<number, string>
  onAssign?: (labels: string[], value: number) => void
  onSetStartPoint?: (value: number, label: string) => void
  onClearManual?: () => void
  /** Отменить последнее заполнение (кнопка / Alt+клик) */
  onUndoLast?: () => void
  /** Снять конкретный кабинет (повторный клик по последнему в активной линии) */
  onUndoCabinet?: (label: string) => void
  /** Перевернуть порядок кабинетов активной линии */
  onReverseActiveLine?: (lineNumber: number) => void
  /** Очистить все кабинеты активной линии */
  onClearActiveLine?: (lineNumber: number) => void
  /** Перенумеровать активную линию (from → to) */
  onRenumberActiveLine?: (from: number, to: number) => void
  canUndo?: boolean
  maxAssignable?: number
  chainStartEdge?: ChainStartEdge
  pitchPreset?: PitchPresetId
  powerFeedMode?: PowerFeedMode
  /** Вертикальные полосы: ширины в колонках; зазоры только визуальные */
  stripWidths?: number[]
  /** Два VX1000 — подсказки UI / лейблы D1-1 */
  dualVx1000?: boolean
  /** Назначение стрипов на VX (1|2) — для будущих подсказок */
  stripControllerIds?: number[]
  /** Ручной VX для data-порта в manual mode */
  dataPortControllers?: Record<number, number>
  onSetDataPortController?: (port: number, controllerId: 1 | 2) => void
  /** Ручные индексы цвета палитры (0-based) для линий */
  lineColorOverrides?: Record<number, number>
  onSetLineColor?: (lineId: number, colorIndex: number) => void
  /** Разрешение экрана в пикселях (W×H) */
  screenPixelsWide?: number
  screenPixelsHigh?: number
  /** Физический размер кабинета — для пропорций ячеек на схеме */
  cabinetWidthMm?: number
  cabinetHeightMm?: number
}

const DESKTOP_CELL_BASE = { w: 88, h: 64, gap: 12, pad: 40, stripGap: 32 }
const MOBILE_CELL_BASE = { w: 56, h: 44, gap: 6, pad: 24, stripGap: 18 }

/** Размер ячейки сетки с сохранением пропорций кабинета (мм) */
function cellMetricsForCabinet(
  cabinetWidthMm: number,
  cabinetHeightMm: number,
  isMobile: boolean,
): { w: number; h: number; gap: number; pad: number; stripGap: number } {
  const base = isMobile ? MOBILE_CELL_BASE : DESKTOP_CELL_BASE
  const minW = isMobile ? 28 : 40
  const minH = isMobile ? 22 : 32

  const cw = Math.max(100, cabinetWidthMm)
  const ch = Math.max(100, cabinetHeightMm)
  const aspect = cw / ch
  const baseAspect = base.w / base.h

  let w: number
  let h: number
  if (aspect >= baseAspect) {
    w = base.w
    h = base.w / aspect
  } else {
    h = base.h
    w = base.h * aspect
  }

  const scaleUp = Math.max(minW / w, minH / h, 1)
  w = Math.round(w * scaleUp)
  h = Math.round(h * scaleUp)

  return { w, h, gap: base.gap, pad: base.pad, stripGap: base.stripGap }
}

const ZOOM_MIN = 0.5
const ZOOM_MAX = 3
const ZOOM_STEP = 0.1

/** Линия + наконечник; на mobile меньше — ячейки 56×44, крупные стрелки перекрывают подписи */
const ARROW_METRICS = {
  desktop: {
    stroke: 4.5,
    outline: 7,
    headLen: 14,
    headAngle: Math.PI / 5.5,
  },
  mobile: {
    stroke: 3.5,
    outline: 5.5,
    headLen: 10,
    headAngle: Math.PI / 5.5,
  },
} as const

/** Стиль как на схеме: треугольник в середине каждого сегмента */
const MID_ARROW_METRICS = {
  desktop: {
    stroke: 2.75,
    outline: 4.5,
    triSize: 11,
  },
  mobile: {
    stroke: 2.25,
    outline: 3.75,
    triSize: 9,
  },
} as const

/** Красный fallback для mid-стрелок (если цвет линии не задан) */
const MID_ARROW_FALLBACK = '#e11d48'
/** Чёрные основные линии mid */
const MID_LINE_COLOR = '#111111'
/** Backup — синий, явно другой от основной чёрной */
const MID_BACKUP_LINE_COLOR = '#2563eb'

type DataArrowStyle = 'classic' | 'mid'

function getArrowMetrics(isMobile: boolean) {
  return isMobile ? ARROW_METRICS.mobile : ARROW_METRICS.desktop
}

function getMidArrowMetrics(isMobile: boolean) {
  return isMobile ? MID_ARROW_METRICS.mobile : MID_ARROW_METRICS.desktop
}

function arrowHeadPoints(
  tipX: number,
  tipY: number,
  angle: number,
  headLen: number,
  headAngle: number,
): string {
  const hx1 = tipX - headLen * Math.cos(angle - headAngle)
  const hy1 = tipY - headLen * Math.sin(angle - headAngle)
  const hx2 = tipX - headLen * Math.cos(angle + headAngle)
  const hy2 = tipY - headLen * Math.sin(angle + headAngle)
  return `${tipX},${tipY} ${hx1},${hy1} ${hx2},${hy2}`
}

/** Равносторонний треугольник по центру сегмента, остриё по направлению потока */
function midTrianglePoints(cx: number, cy: number, angle: number, size: number): string {
  const tipX = cx + Math.cos(angle) * size
  const tipY = cy + Math.sin(angle) * size
  const back = size * 0.55
  const half = size * 0.72
  const bx = cx - Math.cos(angle) * back
  const by = cy - Math.sin(angle) * back
  const px = -Math.sin(angle) * half
  const py = Math.cos(angle) * half
  return `${tipX},${tipY} ${bx + px},${by + py} ${bx - px},${by - py}`
}

/**
 * Mid-стиль: ровная ортогональная линия (без зигзагов на углах) +
 * стрелки контрастного к кубикам цвета.
 */
function MidContinuousChain({
  points,
  color,
  arrowColor = MID_ARROW_FALLBACK,
  isMobile = false,
  dashed = false,
}: {
  points: { x: number; y: number }[]
  color: string
  arrowColor?: string
  isMobile?: boolean
  dashed?: boolean
}) {
  if (points.length < 2) return null
  const mid = getMidArrowMetrics(isMobile)
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(' ')
  const dash = dashed ? (isMobile ? '5 4' : '7 5') : undefined

  return (
    <g pointerEvents="none">
      <path
        d={d}
        fill="none"
        stroke="#ffffff"
        strokeWidth={mid.outline}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="square"
        strokeLinejoin="miter"
        strokeDasharray={dash}
      />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={mid.stroke}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="square"
        strokeLinejoin="miter"
        strokeDasharray={dash}
      />
      {points.slice(0, -1).map((from, i) => {
        const to = points[i + 1]!
        const dx = to.x - from.x
        const dy = to.y - from.y
        const len2 = dx * dx + dy * dy
        if (len2 < 64) return null
        const angle = Math.atan2(dy, dx)
        return (
          <polygon
            key={`mid-tri-${i}`}
            points={midTrianglePoints(
              (from.x + to.x) / 2,
              (from.y + to.y) / 2,
              angle,
              mid.triSize,
            )}
            fill={arrowColor}
            stroke="#ffffff"
            strokeWidth={isMobile ? 0.9 : 1.1}
            strokeLinejoin="round"
          />
        )
      })}
    </g>
  )
}

/** В auto каждая видимая data-линия остаётся внутри своего блока/стрипа. */
function splitAutoChainByStrips<T extends { col: number }>(
  cabinets: T[],
  stripWidths: number[],
  manualMode: boolean,
): T[][] {
  if (manualMode || stripWidths.length <= 1 || cabinets.length < 2) {
    return cabinets.length > 0 ? [cabinets] : []
  }

  const segments: T[][] = []
  let current: T[] = []
  for (const cabinet of cabinets) {
    const previous = current[current.length - 1]
    if (previous && !sameStripCol(previous.col, cabinet.col, stripWidths)) {
      if (current.length > 0) segments.push(current)
      current = []
    }
    current.push(cabinet)
  }
  if (current.length > 0) segments.push(current)
  return segments
}

/**
 * Ровная «полоса» вдоль змейки: на горизонтали — сдвиг по Y, на вертикали — по X.
 * На углу берём пересечение полос (оба сдвига) → только прямые 90°, без зигзагов.
 */
function buildSmoothLanePoints(
  cabinets: { col: number; row: number }[],
  cabCenter: (col: number, row: number) => { x: number; y: number },
  kind: 'data' | 'backup',
  wide: number,
  cellW: number,
  isRtl: boolean,
  isMobile: boolean,
): { x: number; y: number }[] {
  if (cabinets.length < 2) return []

  const centers = cabinets.map((c) => cabCenter(c.col, c.row))
  const yMag = isMobile ? DATA_LANE_OFFSET_MID.mobile : DATA_LANE_OFFSET_MID.desktop
  const yOff = kind === 'data' ? -yMag : yMag

  const isHoriz = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)

  return centers.map((c, i) => {
    const prev = i > 0 ? centers[i - 1]! : null
    const next = i < centers.length - 1 ? centers[i + 1]! : null
    const touchH =
      (prev != null && isHoriz(prev, c)) || (next != null && isHoriz(c, next))
    const touchV =
      (prev != null && !isHoriz(prev, c)) || (next != null && !isHoriz(c, next))

    let dx = 0
    let dy = 0
    if (touchH) dy = yOff
    if (touchV) {
      dx = verticalLaneDesiredNx(
        kind,
        cabinets[i]!.col,
        wide,
        cellW,
        isRtl,
        isMobile,
        true,
      )
    }
    return { x: c.x + dx, y: c.y + dy }
  })
}

const TRUNK_FEED_COLOR = '#ea580c'
const END_LABEL_COLOR = '#0f766e'

const LARGE_GRID_THRESHOLD = 100

/** Левый край кабинета с учётом визуальных зазоров между полосами */
function cabinetLeft(
  col: number,
  cellW: number,
  gap: number,
  pad: number,
  stripGap: number,
  stripWidths: number[],
) {
  return pad + col * (cellW + gap) + stripGapsBeforeCol(col, stripWidths) * stripGap
}

function cabinetCenter(
  col: number,
  row: number,
  cellW: number,
  cellH: number,
  gap: number,
  pad: number,
  stripGap = 0,
  stripWidths: number[] = [1],
) {
  return {
    x: cabinetLeft(col, cellW, gap, pad, stripGap, stripWidths) + cellW / 2,
    y: pad + row * (cellH + gap) + cellH / 2,
  }
}

/** Mid: чуть ближе к центру, но не на цифры */
const DATA_LANE_OFFSET_MID = { desktop: 16, mobile: 11 } as const
/** Зазор между data и backup на вертикальном переходе */
const VERTICAL_PAIR_GAP = { desktop: 14, mobile: 9 } as const
const VERTICAL_PAIR_GAP_MID = { desktop: 16, mobile: 12 } as const
/** Отступ вертикальных линий от внешнего края кубика */
const VERTICAL_EDGE_INSET = { desktop: 12, mobile: 7 } as const
/** Mid: не у самого края — ближе к центру */
const VERTICAL_EDGE_INSET_MID = { desktop: 14, mobile: 9 } as const
/** Power: сдвиг от центра, чтобы не наезжать на номер кубика */
const POWER_LANE_OFFSET = { desktop: 17, mobile: 12 } as const
const POWER_VERTICAL_INSET = { desktop: 14, mobile: 9 } as const

/** Внешняя сторона кубика на вертикальном переходе: -1 слева, +1 справа */
function verticalOuterSign(col: number, wide: number, isRtl: boolean): number {
  if (col <= 0) return -1
  if (col >= wide - 1) return 1
  return isRtl ? -1 : 1
}

/**
 * Желаемый сдвиг по X от центра кабинета для вертикального перехода:
 * пара у внешнего края, между линиями VERTICAL_PAIR_GAP px.
 */
function verticalLaneDesiredNx(
  kind: 'data' | 'backup',
  col: number,
  wide: number,
  cellW: number,
  isRtl: boolean,
  isMobile = false,
  midLanes = false,
): number {
  const outer = verticalOuterSign(col, wide, isRtl)
  const edgeTable = midLanes ? VERTICAL_EDGE_INSET_MID : VERTICAL_EDGE_INSET
  const gapTable = midLanes ? VERTICAL_PAIR_GAP_MID : VERTICAL_PAIR_GAP
  const edgeInset = isMobile ? edgeTable.mobile : edgeTable.desktop
  const pairGap = isMobile ? gapTable.mobile : gapTable.desktop
  const outerFromCenter = cellW / 2 - edgeInset
  if (kind === 'data') return outer * outerFromCenter
  return outer * (outerFromCenter - pairGap)
}

/** Преобразует desiredNx (px) в параметр offset для ArrowPath */
function offsetForDesiredNx(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  desiredNx: number,
): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  return (desiredNx * len) / -dy
}

function ArrowPath({
  x1,
  y1,
  x2,
  y2,
  color,
  dashed = false,
  offset = 0,
  isVertical = false,
  emphasizeHorizontal = false,
  isMobile = false,
  style = 'classic',
}: {
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  dashed?: boolean
  offset?: number
  isVertical?: boolean
  emphasizeHorizontal?: boolean
  isMobile?: boolean
  /** classic — наконечник у конца; mid — красный треугольник в середине сегмента */
  style?: DataArrowStyle
}) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  const nx = (-dy / len) * offset
  const ny = (dx / len) * offset

  const sx = x1 + nx
  const sy = y1 + ny

  const ux = dx / len
  const uy = dy / len
  const angle = Math.atan2(uy, ux)

  if (style === 'mid') {
    const mid = getMidArrowMetrics(isMobile)
    // Линия почти от центра до центра — как на референс-схеме
    const inset = dashed
      ? Math.min(len * 0.18, isMobile ? 10 : 14)
      : Math.min(len * 0.08, isMobile ? 5 : 7)
    const ax = sx + ux * inset
    const ay = sy + uy * inset
    const bx = sx + ux * (len - inset)
    const by = sy + uy * (len - inset)
    const mx = (ax + bx) / 2
    const my = (ay + by) / 2

    return (
      <g pointerEvents="none">
        <line
          x1={ax}
          y1={ay}
          x2={bx}
          y2={by}
          stroke="#ffffff"
          strokeWidth={mid.outline}
          strokeLinecap="round"
        />
        <line
          x1={ax}
          y1={ay}
          x2={bx}
          y2={by}
          stroke={color}
          strokeWidth={
            emphasizeHorizontal
              ? mid.stroke + 0.35
              : isVertical
                ? Math.max(1.75, mid.stroke - 0.25)
                : mid.stroke
          }
          strokeDasharray={dashed ? (isMobile ? '4 3' : '6 4') : undefined}
          strokeLinecap="round"
        />
        <polygon
          points={midTrianglePoints(mx, my, angle, mid.triSize)}
          fill={MID_ARROW_FALLBACK}
          stroke="#ffffff"
          strokeWidth={isMobile ? 0.9 : 1.1}
          strokeLinejoin="round"
        />
      </g>
    )
  }

  const metrics = getArrowMetrics(isMobile)

  // Основные линии длиннее; backup короче. На mobile сильнее отступаем от центров —
  // чтобы наконечники не накрывали A1/B2…
  const startInset = dashed
    ? Math.min(len * 0.26, isMobile ? 16 : 26)
    : Math.min(len * 0.16, isMobile ? 10 : 14)
  const tipInset = dashed
    ? Math.min(len * 0.28, Math.max(metrics.headLen * 0.9, isMobile ? 14 : 24))
    : Math.min(len * 0.18, Math.max(metrics.headLen * 0.55, isMobile ? 9 : 12))
  const ax = sx + ux * startInset
  const ay = sy + uy * startInset
  const bx = sx + ux * (len - tipInset)
  const by = sy + uy * (len - tipInset)

  return (
    <g pointerEvents="none">
      <line
        x1={ax}
        y1={ay}
        x2={bx}
        y2={by}
        stroke="#ffffff"
        strokeWidth={metrics.outline}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1={ax}
        y1={ay}
        x2={bx}
        y2={by}
        stroke={color}
        strokeWidth={
          emphasizeHorizontal
            ? metrics.stroke + 0.5
            : isVertical
              ? Math.max(2.5, metrics.stroke - 0.5)
              : metrics.stroke
        }
        strokeDasharray={dashed ? (isMobile ? '5 4' : '7 5') : undefined}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polygon
        points={arrowHeadPoints(bx, by, angle, metrics.headLen, metrics.headAngle)}
        fill={color}
        stroke="#ffffff"
        strokeWidth={isMobile ? 1.25 : 1.5}
        strokeLinejoin="round"
      />
    </g>
  )
}

export default memo(function GridVisualization({
  result,
  wide,
  high,
  mode,
  screenName = 'Screen',
  wallWidthM = 0,
  wallHeightM = 0,
  controllerModel = 'Generic 1G Controller',
  refreshRate = 60,
  manualMode = false,
  onManualModeChange,
  emptyCabinets = [],
  emptyPaintMode = false,
  onToggleEmpty,
  manualAssignments = {},
  chainOrder = {},
  startPoints = {},
  onAssign,
  onSetStartPoint,
  onClearManual,
  onUndoLast,
  onUndoCabinet,
  onReverseActiveLine,
  onClearActiveLine,
  onRenumberActiveLine: _onRenumberActiveLine,
  canUndo = false,
  maxAssignable = 1,
  chainStartEdge = 'left',
  pitchPreset = '3.9-small',
  powerFeedMode = 'edge',
  stripWidths: stripWidthsProp,
  dualVx1000 = false,
  dataPortControllers,
  onSetDataPortController,
  lineColorOverrides,
  onSetLineColor,
  screenPixelsWide = 0,
  screenPixelsHigh = 0,
  cabinetWidthMm = 500,
  cabinetHeightMm = 500,
}: GridVisualizationProps) {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches,
  )
  const [exportBusy, setExportBusy] = useState(false)
  const captureRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const { w: CELL_W, h: CELL_H, gap: GAP, pad: PAD, stripGap: STRIP_GAP } = useMemo(
    () => cellMetricsForCabinet(cabinetWidthMm, cabinetHeightMm, isMobile),
    [cabinetWidthMm, cabinetHeightMm, isMobile],
  )
  const stripWidths = useMemo(
    () => normalizeStripWidths(stripWidthsProp, wide),
    [stripWidthsProp, wide],
  )
  const stripExtraW = Math.max(0, stripWidths.length - 1) * STRIP_GAP
  const cabLeft = useCallback(
    (col: number) => cabinetLeft(col, CELL_W, GAP, PAD, STRIP_GAP, stripWidths),
    [CELL_W, GAP, PAD, STRIP_GAP, stripWidths],
  )
  const cabCenter = useCallback(
    (col: number, row: number) =>
      cabinetCenter(col, row, CELL_W, CELL_H, GAP, PAD, STRIP_GAP, stripWidths),
    [CELL_W, CELL_H, GAP, PAD, STRIP_GAP, stripWidths],
  )
  const editBtnClass =
    'touch-manipulation min-h-[44px] rounded-md px-3 py-2 text-xs font-semibold transition active:scale-[0.98] sm:min-h-[36px] sm:px-2.5 sm:py-1'
  const manualBtnClass =
    'touch-manipulation shrink-0 rounded px-2 py-1 text-[11px] font-semibold whitespace-nowrap transition active:scale-[0.98]'
  const legendBtnClass =
    'touch-manipulation flex min-h-[40px] items-center gap-1.5 rounded-md px-2.5 py-1.5 transition active:scale-[0.98] sm:min-h-0 sm:px-1 sm:py-0.5'
  const zoomBtnClass =
    'touch-manipulation flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-slate-200 bg-white text-base font-semibold text-slate-700 transition hover:bg-slate-50 active:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-[32px] sm:min-w-[32px] sm:text-sm'

  const {
    cabinets,
    dataChains,
    backupChains,
    powerLines,
    backupLinks,
    powerLinks,
    warnings,
    summary,
  } = result

  const isData = mode === 'data'
  const lineDirection = edgeToDirection(chainStartEdge)
  const isRtl = lineDirection === 'rtl'
  const isReshetPower = !isData && pitchPreset === '3.9-reshet'
  const is29Power = !isData && pitchPreset === '2.9'

  const sequenceStepMap = useMemo(() => {
    const map = new Map<string, number>()
    // В ручном режиме — порядок кликов / цепочки
    if (manualMode) {
      for (const [numStr, labels] of Object.entries(chainOrder)) {
        const list = labels ?? (chainOrder as Record<string, string[]>)[String(numStr)]
        if (!list?.length) continue
        list.forEach((label, idx) => map.set(label, idx + 1))
      }
      if (map.size > 0) return map
    }
    if (isData) {
      for (const chain of dataChains) {
        if (chain.isBackup) continue
        chain.cabinets.forEach((cab, idx) => map.set(cab.label, idx + 1))
      }
    } else {
      for (const line of powerLines) {
        line.cabinets.forEach((cab, idx) => map.set(cab.label, idx + 1))
      }
    }
    return map
  }, [manualMode, chainOrder, isData, dataChains, powerLines])

  const title = isData
    ? 'Data Ports / Тикшорет / תקשורת'
    : 'Power Lines / Электричество / חשמל'
  const prefix = isData ? 'D' : 'P'

  /** Data portNumber → displayId (например «1-1» при dual VX1000). Power всегда P{n}. */
  const displayIdByNumber = useMemo(() => {
    const map = new Map<number, string>()
    if (!isData) return map
    for (const chain of dataChains) {
      if (chain.displayId) map.set(chain.portNumber, chain.displayId)
    }
    return map
  }, [isData, dataChains])

  const dualVxPreviewLabels = useMemo(() => {
    if (!isData || !dualVx1000 || stripWidths.length <= 1 || !manualMode) {
      return new Map<number, string>()
    }
    return previewDualVxLineLabels(dataChains, dataPortControllers, prefix)
  }, [
    isData,
    dualVx1000,
    stripWidths.length,
    manualMode,
    dataChains,
    dataPortControllers,
    prefix,
  ])

  const formatLineId = useCallback(
    (n: number) => {
      const preview = dualVxPreviewLabels.get(n)
      if (preview) return preview
      const display = displayIdByNumber.get(n)
      return display ? `${prefix}${display}` : `${prefix}${n}`
    },
    [displayIdByNumber, dualVxPreviewLabels, prefix],
  )

  /** Показывать номер VX в ID кубика (только data + 2× VX1000 + ≥2 стрипа) */
  const showVxInCabinetId =
    isData && Boolean(dualVx1000) && stripWidths.length > 1

  /**
   * Номер кубика: [VX-]линия-позиция
   * Пример dual: 1-2-5 · без VX: 2-5 · power: 3-1
   */
  const cabinetIdMap = useMemo(() => {
    const map = new Map<string, string>()

    const lineKeyForDataPort = (port: number): string => {
      if (showVxInCabinetId) {
        const preview = dualVxPreviewLabels.get(port)
        if (preview) {
          // «D1-2» → «1-2»
          return preview.replace(/^[DP]/i, '')
        }
        const chain = dataChains.find(
          (c) => c.portNumber === port && !c.isBackup,
        )
        if (chain?.displayId) {
          return chain.displayId.replace(/b$/i, '')
        }
        if (
          (chain?.controllerId === 1 || chain?.controllerId === 2) &&
          chain.localNumber != null
        ) {
          return `${chain.controllerId}-${chain.localNumber}`
        }
      }
      return String(port)
    }

    if (isData) {
      for (const chain of dataChains) {
        if (chain.isBackup) continue
        const lineKey = lineKeyForDataPort(chain.portNumber)
        chain.cabinets.forEach((cab, idx) => {
          const step = sequenceStepMap.get(cab.label) ?? idx + 1
          map.set(cab.label, `${lineKey}-${step}`)
        })
      }
      if (manualMode) {
        for (const [label, port] of Object.entries(manualAssignments)) {
          if (map.has(label) || port < 1) continue
          const step = sequenceStepMap.get(label)
          if (step == null) continue
          map.set(label, `${lineKeyForDataPort(port)}-${step}`)
        }
      }
    } else {
      for (const line of powerLines) {
        line.cabinets.forEach((cab, idx) => {
          const step = sequenceStepMap.get(cab.label) ?? idx + 1
          map.set(cab.label, `${line.lineNumber}-${step}`)
        })
      }
      if (manualMode) {
        for (const [label, lineNum] of Object.entries(manualAssignments)) {
          if (map.has(label) || lineNum < 1) continue
          const step = sequenceStepMap.get(label)
          if (step == null) continue
          map.set(label, `${lineNum}-${step}`)
        }
      }
    }
    return map
  }, [
    isData,
    showVxInCabinetId,
    dualVxPreviewLabels,
    dataChains,
    powerLines,
    sequenceStepMap,
    manualMode,
    manualAssignments,
  ])

  /** Только линии с кабинетами — не пустые слоты и не backup */
  const dataLineCount = useMemo(() => {
    const used = dataChains.filter((c) => !c.isBackup && c.cabinets.length > 0).length
    return used > 0 ? used : Math.max(0, summary.dataPorts)
  }, [dataChains, summary.dataPorts])
  const powerLineCount = useMemo(() => {
    const used = powerLines.filter((l) => l.cabinets.length > 0).length
    return used > 0 ? used : Math.max(0, summary.powerLines)
  }, [powerLines, summary.powerLines])
  const backupLineCount = useMemo(() => {
    const used = backupChains.filter((c) => c.cabinets.length > 0).length
    return used > 0 ? used : Math.max(0, summary.backupPorts)
  }, [backupChains, summary.backupPorts])
  const resolutionLabel =
    screenPixelsWide > 0 && screenPixelsHigh > 0
      ? `${screenPixelsWide.toLocaleString()}×${screenPixelsHigh.toLocaleString()} px`
      : null

  /** При 2× VX1000 — линии и нумерация по каждому контроллеру */
  const dualVxBreakdown = useMemo(() => {
    if (!isData || !dualVx1000) return null

    const byController = new Map<number, { main: string[]; backup: string[] }>()
    const ensure = (id: number) => {
      if (!byController.has(id)) byController.set(id, { main: [], backup: [] })
      return byController.get(id)!
    }

    for (const chain of dataChains) {
      if (chain.isBackup || chain.cabinets.length === 0) continue
      const cid = chain.controllerId ?? 1
      const id = chain.displayId ?? String(chain.portNumber)
      ensure(cid).main.push(`D${id}`)
    }

    for (const chain of backupChains) {
      if (chain.cabinets.length === 0) continue
      const cid = chain.controllerId ?? 1
      const id = chain.displayId ?? String(chain.portNumber)
      ensure(cid).backup.push(`D${id}`)
    }

    if (byController.size === 0) return null

    return [...byController.entries()]
      .sort(([a], [b]) => a - b)
      .map(([controllerId, { main, backup }]) => ({
        controllerId,
        mainLabels: main,
        backupLabels: backup,
      }))
  }, [isData, dualVx1000, dataChains, backupChains])

  const headerStats = useMemo(() => {
    if (isData && dualVxBreakdown) return null

    const parts: string[] = []
    if (screenName.trim()) parts.push(screenName.trim())
    if (isData && resolutionLabel) parts.push(resolutionLabel)
    if (isData) {
      parts.push(`${dataLineCount} линий тикшорет`)
      if (backupLineCount > 0) parts.push(`${backupLineCount} backup`)
    } else {
      parts.push(`${powerLineCount} линий электричества`)
    }
    return parts.join(' · ')
  }, [
    screenName,
    resolutionLabel,
    isData,
    dualVxBreakdown,
    dataLineCount,
    backupLineCount,
    powerLineCount,
  ])

  const headerBaseLine = useMemo(() => {
    if (!isData || !dualVxBreakdown) return null
    const parts: string[] = []
    if (screenName.trim()) parts.push(screenName.trim())
    if (resolutionLabel) parts.push(resolutionLabel)
    return parts.length > 0 ? parts.join(' · ') : null
  }, [isData, dualVxBreakdown, screenName, resolutionLabel])

  const pitchLabel = useMemo(() => {
    if (pitchPreset === 'custom') return CUSTOM_PRESET_LABEL
    return getPitchPreset(pitchPreset)?.label ?? pitchPreset
  }, [pitchPreset])

  const printInfo = useMemo((): PanelPrintInfo => {
    return {
      screenName,
      wallWidthM,
      wallHeightM,
      cabinetsWide: wide,
      cabinetsHigh: high,
      pitchLabel,
      controllerModel,
      panelType: isData
        ? 'Data Ports / Тикшорет'
        : 'Power Lines / Электричество',
      refreshRate,
      lineDirection: lineDirection.toUpperCase(),
      ...(isData
        ? {
            dataLines: dataLineCount,
            ...(backupLineCount > 0 ? { backupLines: backupLineCount } : {}),
          }
        : { powerLines: powerLineCount }),
    }
  }, [
    screenName,
    wallWidthM,
    wallHeightM,
    wide,
    high,
    pitchLabel,
    controllerModel,
    isData,
    refreshRate,
    lineDirection,
    summary.backupPorts,
    backupLineCount,
    dataLineCount,
    powerLineCount,
    backupChains,
  ])

  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set())
  const [activeValue, setActiveValue] = useState(1)
  const [editMode, setEditMode] = useState<ManualEditMode>('assign')
  /** Контекст VX1/VX2 для выбора и создания линий D1-x / D2-x */
  const [manualVxContext, setManualVxContext] = useState<1 | 2>(1)
  const manualKeyboardRef = useRef<HTMLDivElement>(null)

  const getChainForPort = useCallback(
    (port: number) => {
      const direct = chainOrder[port]
      if (direct) return direct
      const asString = (chainOrder as Record<string, string[]>)[String(port)]
      return asString ?? []
    },
    [chainOrder],
  )

  const canDualVxManual =
    isData && dualVx1000 && stripWidths.length > 1 && manualMode

  const activePortController = useMemo(() => {
    if (!canDualVxManual) return 1 as const
    const manual = dataPortControllers?.[activeValue]
    if (manual === 1 || manual === 2) return manual
    const chain = dataChains.find(
      (c) => c.portNumber === activeValue && !c.isBackup,
    )
    if (chain?.controllerId === 1 || chain?.controllerId === 2) {
      return chain.controllerId
    }
    return 1 as const
  }, [canDualVxManual, dataPortControllers, activeValue, dataChains])

  const autoControllerHint = useMemo(() => {
    if (!canDualVxManual) return null
    const manual = dataPortControllers?.[activeValue]
    if (manual === 1 || manual === 2) return `вручную: VX${manual}`
    const chain = dataChains.find(
      (c) => c.portNumber === activeValue && !c.isBackup,
    )
    if (!chain || chain.cabinets.length === 0) {
      return 'авто по стрипу при первом клике'
    }
    if (chain.controllerId === 1 || chain.controllerId === 2) {
      return `авто: VX${chain.controllerId}`
    }
    return null
  }, [canDualVxManual, dataChains, activeValue, dataPortControllers])

  useEffect(() => {
    if (canDualVxManual) setManualVxContext(activePortController)
  }, [canDualVxManual, activeValue, activePortController])

  useEffect(() => {
    setSelectedLabels(new Set())
    setActiveValue(1)
    setEditMode('assign')
  }, [manualMode, wide, high, mode])

  const emptySet = useMemo(() => new Set(emptyCabinets), [emptyCabinets])

  const svgW = PAD * 2 + wide * CELL_W + (wide - 1) * GAP + stripExtraW
  const svgH = PAD * 2 + high * CELL_H + (high - 1) * GAP + 30

  const gridScrollRef = useRef<HTMLDivElement>(null)
  const [fitScale, setFitScale] = useState(1)
  const [zoomLevel, setZoomLevel] = useState(1)

  const effectiveScale = fitScale * zoomLevel
  const zoomPercent = Math.round(zoomLevel * 100)
  const totalCells = wide * high
  const simplifyLabels = totalCells > LARGE_GRID_THRESHOLD

  const clampZoom = useCallback(
    (value: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 10) / 10)),
    [],
  )

  const calculateFitScale = useCallback(() => {
    const container = gridScrollRef.current
    if (!container || svgW <= 0 || svgH <= 0) return 1
    const availableW = container.clientWidth
    if (availableW <= 0) return 1
    return Math.min(availableW / svgW, 1)
  }, [svgW, svgH])

  const fitToScreen = useCallback(() => {
    setFitScale(calculateFitScale())
    setZoomLevel(1)
  }, [calculateFitScale])

  useLayoutEffect(() => {
    setFitScale(calculateFitScale())
    setZoomLevel(1)
  }, [wide, high, isMobile, calculateFitScale])

  useEffect(() => {
    const container = gridScrollRef.current
    if (!container) return

    const onResize = () => {
      setFitScale(calculateFitScale())
    }

    const observer = new ResizeObserver(onResize)
    observer.observe(container)
    return () => observer.disconnect()
  }, [calculateFitScale])

  const zoomIn = useCallback(() => {
    setZoomLevel((prev) => clampZoom(prev + ZOOM_STEP))
  }, [clampZoom])

  const zoomOut = useCallback(() => {
    setZoomLevel((prev) => clampZoom(prev - ZOOM_STEP))
  }, [clampZoom])

  const assignmentMap = useMemo(() => {
    const map = new Map<string, number>()
    const applyFromGroups = () => {
      if (isData) {
        for (const chain of dataChains) {
          for (const cab of chain.cabinets) {
            map.set(cab.label, chain.portNumber)
          }
        }
      } else {
        for (const line of powerLines) {
          for (const cab of line.cabinets) {
            map.set(cab.label, line.lineNumber)
          }
        }
      }
    }

    if (manualMode) {
      applyFromGroups()
      for (const cab of cabinets) {
        if (emptySet.has(cab.label)) continue
        const val = manualAssignments[cab.label]
        if (val != null) map.set(cab.label, val)
      }
    } else {
      applyFromGroups()
    }
    return map
  }, [manualMode, manualAssignments, cabinets, isData, dataChains, powerLines, emptySet])

  /** Номера линий, у которых есть хотя бы один кабинет (для легенды / цветов / счётчика) */
  const usedLineNumbers = useMemo(() => {
    const fromMap = new Set<number>()
    for (const n of assignmentMap.values()) {
      if (n >= 1) fromMap.add(n)
    }
    if (fromMap.size > 0) return [...fromMap].sort((a, b) => a - b)
    const fromResult = isData
      ? dataChains.filter((c) => !c.isBackup && c.cabinets.length > 0).map((c) => c.portNumber)
      : powerLines.filter((l) => l.cabinets.length > 0).map((l) => l.lineNumber)
    return [...new Set(fromResult)].filter((n) => n >= 1).sort((a, b) => a - b)
  }, [assignmentMap, isData, dataChains, powerLines])

  /** Кнопки выбора: все расчётные линии + активная + слот для новой линии. */
  const valueNumbers = useMemo(() => {
    const combined = new Set(usedLineNumbers)
    if (manualMode) {
      // Все рассчитанные D/P остаются доступными после Clear:
      // очищенную линию можно снова выбрать и нарисовать с нуля.
      for (let n = 1; n <= maxAssignable; n++) combined.add(n)
      if (activeValue >= 1) combined.add(activeValue)
      const maxUsed = usedLineNumbers.length > 0 ? Math.max(...usedLineNumbers) : 0
      const nextSlot = Math.max(maxAssignable, maxUsed) + 1
      if (nextSlot >= 1 && nextSlot <= maxAssignable + 1) combined.add(nextSlot)
      for (const n of Object.values(manualAssignments)) {
        if (n >= 1) combined.add(n)
      }
    }
    return [...combined].filter((n) => n >= 1).sort((a, b) => a - b)
  }, [usedLineNumbers, manualMode, activeValue, maxAssignable, manualAssignments])

  const colorMode: LineColorMode = isData ? 'data' : 'power'

  const lineColorMap = useMemo(
    () =>
      computeLineColorMap(
        colorMode,
        cabinets,
        assignmentMap,
        usedLineNumbers.length > 0 ? usedLineNumbers : valueNumbers,
        lineColorOverrides,
      ),
    [colorMode, cabinets, assignmentMap, usedLineNumbers, valueNumbers, lineColorOverrides],
  )

  const lineColorFor = useCallback(
    (lineId: number) => lineColorFromMap(colorMode, lineId, lineColorMap),
    [colorMode, lineColorMap],
  )

  const swatches = useMemo(() => paletteSwatches(colorMode), [colorMode])

  const visibleLinePorts = useMemo(() => {
    if (!canDualVxManual) return valueNumbers
    const cid = manualVxContext
    const ports = new Set<number>()
    for (const [port, label] of dualVxPreviewLabels) {
      if (label.startsWith(`${prefix}${cid}-`)) ports.add(port)
    }
    if (dataPortControllers?.[activeValue] === cid) ports.add(activeValue)
    return [...ports].sort((a, b) => a - b)
  }, [
    canDualVxManual,
    valueNumbers,
    dualVxPreviewLabels,
    manualVxContext,
    prefix,
    dataPortControllers,
    activeValue,
  ])

  const handleNewLineForVx = useCallback(
    (cid: 1 | 2 = manualVxContext) => {
      const used = new Set([
        ...valueNumbers,
        ...Object.values(manualAssignments),
        activeValue,
      ])
      const nextPort = Math.max(1, ...used, 0) + 1
      onSetDataPortController?.(nextPort, cid)
      setManualVxContext(cid)
      setActiveValue(nextPort)
    },
    [
      manualVxContext,
      valueNumbers,
      manualAssignments,
      activeValue,
      onSetDataPortController,
    ],
  )

  const handleSelectVx = useCallback(
    (cid: 1 | 2) => {
      setManualVxContext(cid)
      const portsOnVx = [...dualVxPreviewLabels.entries()]
        .filter(([, label]) => label.startsWith(`${prefix}${cid}-`))
        .map(([port]) => port)
        .sort((a, b) => a - b)
      const activeLabel = dualVxPreviewLabels.get(activeValue)
      if (activeLabel?.startsWith(`${prefix}${cid}-`)) {
        onSetDataPortController?.(activeValue, cid)
        return
      }
      if (portsOnVx.length > 0) {
        setActiveValue(portsOnVx[0]!)
        onSetDataPortController?.(portsOnVx[0]!, cid)
      } else {
        handleNewLineForVx(cid)
      }
    },
    [
      activeValue,
      dualVxPreviewLabels,
      prefix,
      onSetDataPortController,
      handleNewLineForVx,
    ],
  )

  const effectiveStartPoints = useMemo(() => {
    const map: Record<number, string> = { ...startPoints }
    if (isData) {
      for (const chain of dataChains) {
        if (chain.isBackup || chain.cabinets.length === 0) continue
        if (map[chain.portNumber]) continue
        map[chain.portNumber] = manualMode
          ? chain.cabinets[0].label
          : (inferDataChainStart(chain.cabinets, chainStartEdge) ??
            chain.cabinets[0].label)
      }
    } else {
      for (const line of powerLines) {
        if (line.cabinets.length === 0) continue
        if (map[line.lineNumber]) continue
        // Auto / ручная цепь: старт = cabinets[0]; в center feed это центр полосы
        map[line.lineNumber] =
          manualMode || powerFeedMode === 'center'
            ? line.cabinets[0].label
            : (inferPowerLineStart(line.cabinets, chainStartEdge, powerFeedMode) ??
              line.cabinets[0].label)
      }
    }
    return map
  }, [
    manualMode,
    startPoints,
    isData,
    dataChains,
    powerLines,
    chainStartEdge,
    powerFeedMode,
  ])

  const startLabels = useMemo(() => {
    const set = new Set<string>()
    for (const label of Object.values(effectiveStartPoints)) {
      if (label) set.add(label)
    }
    return set
  }, [effectiveStartPoints])

  /** Номер линии (D/P) на START-кабинете — для бейджа, видимого и при simplifyLabels */
  const startLineByLabel = useMemo(() => {
    const map = new Map<string, number>()
    for (const [numStr, label] of Object.entries(effectiveStartPoints)) {
      if (!label) continue
      const n = Number(numStr)
      if (n >= 1) map.set(label, n)
    }
    return map
  }, [effectiveStartPoints])

  const feedPointsByLine = useMemo(() => {
    if (isData) return {} as Record<number, string>
    const map: Record<number, string> = {}
    for (const line of powerLines) {
      if (line.cabinets.length > 0) {
        map[line.lineNumber] = getPowerTrunkCabinet(line, powerFeedMode).label
      }
    }
    return map
  }, [isData, powerLines, powerFeedMode])

  const feedLabels = useMemo(() => {
    return new Set(Object.values(feedPointsByLine))
  }, [feedPointsByLine])

  /** Последний кабинет каждой D/P линии — метка End (учитывает reverse: cabinets[].at(-1)) */
  const endLabels = useMemo(() => {
    const set = new Set<string>()
    if (isData) {
      for (const chain of dataChains) {
        if (chain.isBackup || chain.cabinets.length === 0) continue
        set.add(chain.cabinets[chain.cabinets.length - 1].label)
      }
    } else {
      for (const line of powerLines) {
        if (line.cabinets.length === 0) continue
        set.add(line.cabinets[line.cabinets.length - 1].label)
      }
    }
    return set
  }, [isData, dataChains, powerLines])

  const warnedIds = useMemo(() => {
    const type = isData ? 'data' : 'power'
    return new Set(
      warnings.filter((w) => w.type === type).map((w) => w.id),
    )
  }, [warnings, isData])

  const assignTo = useCallback(
    (labels: string[], value: number) => {
      if (!manualMode || !onAssign || labels.length === 0) return
      onAssign(labels, value)
      setSelectedLabels(new Set())
    },
    [manualMode, onAssign],
  )

  const labelAtCell = useCallback(
    (col: number, row: number): string | null => {
      if (col < 0 || col >= wide || row < 0 || row >= high) return null
      return cabinets.find((c) => c.col === col && c.row === row)?.label ?? null
    },
    [cabinets, wide, high],
  )

  const neighborLabel = useCallback(
    (fromLabel: string, key: string): string | null => {
      const cab = cabinets.find((c) => c.label === fromLabel)
      if (!cab) return null
      let nextCol = cab.col
      let nextRow = cab.row
      if (key === 'ArrowLeft') nextCol = cab.col - 1
      else if (key === 'ArrowRight') nextCol = cab.col + 1
      else if (key === 'ArrowUp') nextRow = cab.row - 1
      else if (key === 'ArrowDown') nextRow = cab.row + 1
      else return null
      return labelAtCell(nextCol, nextRow)
    },
    [cabinets, labelAtCell],
  )

  /** Стрелки продолжают активную линию от последнего кабинета (режим Paint) */
  useEffect(() => {
    if (!manualMode || editMode !== 'assign') return

    const onKeyDown = (e: KeyboardEvent) => {
      const isArrow =
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown'
      if (!isArrow) return

      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }

      e.preventDefault()
      e.stopPropagation()

      const chain = getChainForPort(activeValue)
      const last = chain.at(-1)
      if (!last) return

      const next = neighborLabel(last, e.key)
      if (!next || emptySet.has(next)) return

      // Стрелка назад на предыдущий кабинет — снять последний (как undo)
      const prev = chain.at(-2)
      if (prev && next === prev && onUndoCabinet) {
        onUndoCabinet(last)
        return
      }

      if (next === last) return

      assignTo([next], activeValue)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [
    manualMode,
    editMode,
    getChainForPort,
    activeValue,
    neighborLabel,
    emptySet,
    onUndoCabinet,
    assignTo,
  ])

  useEffect(() => {
    if (manualMode && editMode === 'assign') {
      manualKeyboardRef.current?.focus({ preventScroll: true })
    }
  }, [manualMode, editMode, activeValue])

  const handleCabinetClick = useCallback(
    (label: string, shiftKey: boolean, altKey: boolean) => {
      // Глобальный Empty из сайдбара не блокирует Paint/Set Start в ручном режиме
      const sidebarEmptyOnly =
        emptyPaintMode && (!manualMode || editMode === 'empty')

      if (sidebarEmptyOnly && onToggleEmpty) {
        onToggleEmpty(label)
        return
      }

      if (!manualMode) return

      // Alt+клик — отменить последнее заполнение
      if (altKey && onUndoLast && canUndo) {
        onUndoLast()
        return
      }

      if (editMode === 'empty' && onToggleEmpty) {
        onToggleEmpty(label)
        return
      }

      if (editMode === 'start') {
        if (onSetStartPoint) {
          onSetStartPoint(activeValue, label)
        }
        return
      }

      if (shiftKey) {
        setSelectedLabels((prev) => {
          const next = new Set(prev)
          if (next.has(label)) next.delete(label)
          else next.add(label)
          return next
        })
        return
      }

      if (selectedLabels.size > 0) {
        assignTo([...selectedLabels], activeValue)
        return
      }

      // Повторный клик по последнему кабинету активной линии — отмена
      const lastInActive = getChainForPort(activeValue).at(-1)
      if (onUndoCabinet && label === lastInActive) {
        onUndoCabinet(label)
        return
      }

      assignTo([label], activeValue)
    },
    [
      manualMode,
      emptyPaintMode,
      onToggleEmpty,
      editMode,
      onSetStartPoint,
      selectedLabels,
      activeValue,
      assignTo,
      onUndoLast,
      canUndo,
      chainOrder,
      getChainForPort,
      onUndoCabinet,
    ],
  )

  const handleLegendClick = useCallback(
    (value: number) => {
      if (!manualMode) return
      setActiveValue(value)
      if (selectedLabels.size > 0) {
        assignTo([...selectedLabels], value)
      }
    },
    [manualMode, selectedLabels, assignTo],
  )

  const handleClearManual = useCallback(() => {
    if (!onClearManual) return
    onClearManual()
    setSelectedLabels(new Set())
    setActiveValue(1)
    setEditMode('assign')
  }, [onClearManual])

  /** Снимок всей карточки панели (заголовок, легенда, zoom, SVG), без обрезки scroll */
  const captureDiagram = useCallback(async () => {
    const node = captureRef.current
    if (!node) throw new Error('Схема недоступна для экспорта')
    return capturePanelPng(node)
  }, [])

  const handlePrintScreen = useCallback(async () => {
    if (exportBusy) return
    setExportBusy(true)
    try {
      const dataUrl = await captureDiagram()
      const filename = panelExportFilename(mode, screenName)
      await printPanelPng(dataUrl, title, filename, {
        ...printInfo,
        date: new Date().toLocaleDateString(),
      })
    } catch (error) {
      console.error('Print screen failed', error)
      window.alert(
        isData
          ? 'Не удалось сделать скрин Data Ports. / Screenshot failed.'
          : 'Не удалось сделать скрин Power Lines. / Screenshot failed.',
      )
    } finally {
      setExportBusy(false)
    }
  }, [captureDiagram, exportBusy, isData, mode, printInfo, screenName, title])

  const handleWhatsAppShare = useCallback(async () => {
    if (exportBusy) return
    setExportBusy(true)
    try {
      const dataUrl = await captureDiagram()
      const filename = panelExportFilename(mode, screenName)
      await sharePanelViaWhatsApp({ dataUrl, filename, mode })
    } catch (error) {
      console.error('WhatsApp share failed', error)
      window.alert(
        isData
          ? 'Не удалось подготовить схему для WhatsApp. / Share failed.'
          : 'Не удалось подготовить схему для WhatsApp. / Share failed.',
      )
    } finally {
      setExportBusy(false)
    }
  }, [captureDiagram, exportBusy, isData, mode, screenName])

  const handleSaveImage = useCallback(async () => {
    if (exportBusy) return
    setExportBusy(true)
    try {
      const dataUrl = await captureDiagram()
      const filename = panelExportFilename(mode, screenName)
      downloadDataUrl(dataUrl, filename)
    } catch (error) {
      console.error('Save image failed', error)
      window.alert(
        isData
          ? 'Не удалось сохранить картинку Data Ports. / Save failed.'
          : 'Не удалось сохранить картинку Power Lines. / Save failed.',
      )
    } finally {
      setExportBusy(false)
    }
  }, [captureDiagram, exportBusy, isData, mode, screenName])

  return (
    <div
      ref={captureRef}
      className={`overflow-x-auto rounded-xl border bg-white p-3 shadow-sm sm:p-4 ${
        manualMode || emptyPaintMode
          ? 'border-amber-300 ring-1 ring-amber-200'
          : 'border-slate-200'
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          </div>
          {(manualMode || emptyPaintMode) && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
              {emptyPaintMode && (!manualMode || editMode === 'empty')
                ? 'EMPTY MODE'
                : 'EDIT MODE'}
            </span>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {onManualModeChange && (
            <button
              type="button"
              role="switch"
              aria-checked={manualMode}
              aria-label={`Manual Routing / Ручная схема (${isData ? 'Data' : 'Power'})`}
              onClick={() => onManualModeChange(!manualMode)}
              className={`${editBtnClass} ${
                manualMode
                  ? 'bg-amber-500 text-white hover:bg-amber-600'
                  : 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50'
              }`}
            >
              Manual Routing / Ручная схема ({isData ? 'Data' : 'Power'})
            </button>
          )}
          <button
            type="button"
            onClick={() => void handlePrintScreen()}
            disabled={exportBusy}
            aria-label="Print screen / Печать / צילום מסך"
            className={`${editBtnClass} bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60`}
          >
            Print screen / Печать / צילום מסך
          </button>
          <button
            type="button"
            onClick={() => void handleSaveImage()}
            disabled={exportBusy}
            aria-label="Save image / Сохранить картинку / שמור תמונה"
            className={`${editBtnClass} bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60`}
          >
            Save image / Сохранить картинку / שמור תמונה
          </button>
          <button
            type="button"
            onClick={() => void handleWhatsAppShare()}
            disabled={exportBusy}
            aria-label="WhatsApp"
            className={`${editBtnClass} bg-[#25D366] text-white hover:bg-[#1ebe57] disabled:cursor-wait disabled:opacity-60`}
          >
            WhatsApp
          </button>
          <div
            className="flex items-center gap-1"
            role="group"
            aria-label="Масштаб сетки"
          >
          <button
            type="button"
            onClick={zoomOut}
            disabled={zoomLevel <= ZOOM_MIN}
            className={zoomBtnClass}
            aria-label="Уменьшить"
            title="Уменьшить"
          >
            −
          </button>
          <span
            className="min-w-[3.25rem] px-1 text-center text-xs font-semibold tabular-nums text-slate-600"
            aria-live="polite"
          >
            {zoomPercent}%
          </span>
          <button
            type="button"
            onClick={zoomIn}
            disabled={zoomLevel >= ZOOM_MAX}
            className={zoomBtnClass}
            aria-label="Увеличить"
            title="Увеличить"
          >
            +
          </button>
          <button
            type="button"
            onClick={fitToScreen}
            className={`${zoomBtnClass} min-w-[3.5rem] px-2 text-xs sm:min-w-[3rem]`}
            aria-label="Вписать в экран"
            title="Вписать в экран"
          >
            Fit
          </button>
          </div>
        </div>
      </div>

      {(headerStats || dualVxBreakdown) && (
        <div
          className={`mb-3 mt-2 rounded-lg border px-3 py-2.5 text-xs font-semibold tabular-nums sm:text-sm ${
            isData
              ? 'border-blue-200 bg-blue-50 text-blue-950'
              : 'border-amber-200 bg-amber-50 text-amber-950'
          }`}
        >
          {dualVxBreakdown ? (
            <div className="space-y-1.5">
              {headerBaseLine && <div>{headerBaseLine}</div>}
              <div className="text-[10px] font-bold uppercase tracking-wide text-blue-800/70 sm:text-[11px]">
                2× VX1000
              </div>
              {dualVxBreakdown.map(({ controllerId, mainLabels, backupLabels }) => (
                <div key={controllerId} className="leading-snug">
                  <span className="text-blue-900">
                    VX1000 #{controllerId}: {mainLabels.length}{' '}
                    {mainLabels.length === 1 ? 'линия' : mainLabels.length < 5 ? 'линии' : 'линий'}
                  </span>
                  {' — '}
                  <span className="font-medium">{mainLabels.join(', ')}</span>
                  {backupLabels.length > 0 && (
                    <span className="font-normal text-blue-900/80">
                      {' · backup: '}
                      {backupLabels.join(', ')}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            headerStats
          )}
        </div>
      )}

      {emptyPaintMode && (
        <div className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">
          <strong>Empty / Пропущенный</strong> — клик по ячейке помечает или снимает пустую
          кабинетку (исключается из маршрутизации и подсчётов).
          {manualMode && editMode !== 'empty' && (
            <span className="ml-1 text-slate-500">
              (в ручном режиме Paint/Set Start — используйте панель ниже)
            </span>
          )}
        </div>
      )}

      {manualMode && (
        <div
          ref={manualKeyboardRef}
          tabIndex={-1}
          className="sticky top-0 z-10 mb-3 space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-2 text-xs text-amber-900 shadow-sm outline-none"
        >
          <p className="px-1 text-[11px] font-semibold text-amber-950">
            {isData ? 'Data' : 'Power'} — ручная схема
          </p>
          <div className="flex flex-nowrap items-center gap-1 overflow-x-auto pb-0.5">
            <button
              type="button"
              onClick={() => setEditMode('assign')}
              className={`${manualBtnClass} ${
                editMode === 'assign'
                  ? 'bg-amber-600 text-white'
                  : 'bg-white text-amber-900 ring-1 ring-amber-300'
              }`}
            >
              Краска
            </button>
            {onUndoLast && (
              <button
                type="button"
                onClick={onUndoLast}
                disabled={!canUndo}
                className={`${manualBtnClass} ${
                  canUndo
                    ? 'bg-white text-amber-900 ring-1 ring-amber-300'
                    : 'cursor-not-allowed bg-white/60 text-amber-400 ring-1 ring-amber-200'
                }`}
                title="Alt+клик"
              >
                Undo
              </button>
            )}
            {onReverseActiveLine && (
              <button
                type="button"
                onClick={() => onReverseActiveLine(activeValue)}
                disabled={getChainForPort(activeValue).length < 2}
                className={`${manualBtnClass} ${
                  getChainForPort(activeValue).length >= 2
                    ? 'bg-white text-amber-900 ring-1 ring-amber-300'
                    : 'cursor-not-allowed bg-white/60 text-amber-400 ring-1 ring-amber-200'
                }`}
              >
                Reverse
              </button>
            )}
            {onClearActiveLine && (
              <button
                type="button"
                onClick={() => onClearActiveLine(activeValue)}
                disabled={getChainForPort(activeValue).length === 0}
                className={`${manualBtnClass} ${
                  getChainForPort(activeValue).length > 0
                    ? 'bg-white text-red-700 ring-1 ring-red-300'
                    : 'cursor-not-allowed bg-white/60 text-red-300 ring-1 ring-red-200'
                }`}
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={() => setEditMode('start')}
              className={`${manualBtnClass} ${
                editMode === 'start'
                  ? 'bg-amber-600 text-white'
                  : 'bg-white text-amber-900 ring-1 ring-amber-300'
              }`}
            >
              Старт
            </button>
            <button
              type="button"
              onClick={() => setEditMode('empty')}
              className={`${manualBtnClass} ${
                editMode === 'empty'
                  ? 'bg-green-600 text-white'
                  : 'bg-white text-amber-900 ring-1 ring-amber-300'
              }`}
            >
              Empty
            </button>
            {onClearManual && (
              <button
                type="button"
                onClick={handleClearManual}
                className={`${manualBtnClass} bg-white text-red-700 ring-1 ring-red-300`}
              >
                Сброс
              </button>
            )}
            {canDualVxManual && onSetDataPortController && (
              <>
                <span className="mx-0.5 text-amber-700">|</span>
                {([1, 2] as const).map((cid) => (
                  <button
                    key={`vx-${cid}`}
                    type="button"
                    onClick={() => handleSelectVx(cid)}
                    className={`${manualBtnClass} ${
                      manualVxContext === cid
                        ? 'bg-blue-600 text-white ring-1 ring-blue-500'
                        : 'bg-white text-amber-900 ring-1 ring-amber-300'
                    }`}
                  >
                    VX{cid}
                  </button>
                ))}
              </>
            )}
            <span className="mx-0.5 text-amber-700">|</span>
            {(canDualVxManual ? visibleLinePorts : valueNumbers).map((n) => (
              <button
                key={`sel-${n}`}
                type="button"
                onClick={() => setActiveValue(n)}
                className={`${manualBtnClass} ${
                  activeValue === n
                    ? 'bg-amber-600 text-white'
                    : 'bg-white text-amber-900 ring-1 ring-amber-300'
                }`}
              >
                {formatLineId(n)}
                {editMode === 'start' && effectiveStartPoints[n] && (
                  <span className="ml-0.5 text-[9px] opacity-80">★</span>
                )}
              </button>
            ))}
            <button
              type="button"
              onClick={() =>
                canDualVxManual
                  ? handleNewLineForVx(manualVxContext)
                  : setActiveValue(maxAssignable + 1)
              }
              className={`${manualBtnClass} ${
                canDualVxManual &&
                !visibleLinePorts.includes(activeValue) &&
                dataPortControllers?.[activeValue] === manualVxContext
                  ? 'bg-amber-600 text-white'
                  : 'bg-white text-amber-900 ring-1 ring-amber-300'
              }`}
            >
              {canDualVxManual
                ? `+ ${prefix}${manualVxContext}-${nextDualVxLocalNumber(
                    manualVxContext,
                    dataChains,
                    dataPortControllers,
                    prefix,
                  )}`
                : `+ ${prefix}${maxAssignable + 1}`}
            </button>
            {editMode === 'assign' && selectedLabels.size > 0 && (
              <button
                type="button"
                onClick={() => assignTo([...selectedLabels], activeValue)}
                className={`${manualBtnClass} bg-amber-600 text-white`}
              >
                Apply {selectedLabels.size}
              </button>
            )}
          </div>
          <p className="px-1 text-[10px] leading-snug text-amber-800/90">
            Активно: <strong>{formatLineId(activeValue)}</strong>
            {canDualVxManual && autoControllerHint ? ` · ${autoControllerHint}` : ''}
            {isData && stripWidths.length > 1
              ? ' · линия не переходит между стрипами'
              : ''}
            {editMode === 'assign' ? ' · ←↑↓→ после первого клика' : ''}
          </p>
          {onSetLineColor && editMode !== 'empty' && (
            <div className="flex flex-wrap items-center gap-1 px-1">
              <span className="text-[10px] font-medium text-amber-900">Цвет:</span>
              {swatches.map((swatch, idx) => {
                const selected = lineColorMap.get(activeValue) === idx
                return (
                  <button
                    key={`color-${idx}`}
                    type="button"
                    onClick={() => onSetLineColor(activeValue, idx)}
                    className={`h-5 w-5 shrink-0 rounded border-2 transition active:scale-95 ${
                      selected ? 'ring-2 ring-amber-600 ring-offset-1' : 'hover:scale-110'
                    }`}
                    style={{ backgroundColor: swatch.fill, borderColor: swatch.stroke }}
                    title={`Палитра ${idx + 1}`}
                    aria-label={`Цвет линии ${idx + 1}`}
                    aria-pressed={selected}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600">
        {isData ? (
          <>
            <span className="font-medium text-slate-700">Data:</span>
            {usedLineNumbers.map((port) => {
              const c = lineColorFor(port)
              const hasWarning = warnedIds.has(port)
              return (
                <button
                  key={`leg-d-${port}`}
                  type="button"
                  disabled={!manualMode}
                  onClick={() => handleLegendClick(port)}
                  className={`${legendBtnClass} ${
                    manualMode
                      ? activeValue === port
                        ? 'bg-amber-100 ring-1 ring-amber-400'
                        : 'hover:bg-slate-100'
                      : ''
                  }`}
                >
                  <span
                    className="inline-block h-3 w-3 rounded-sm border-2"
                    style={{ backgroundColor: c.fill, borderColor: c.stroke }}
                  />
                  D{displayIdByNumber.get(port) ?? port}
                  {hasWarning && (
                    <span className="rounded bg-red-100 px-1 text-[9px] font-bold text-red-700">
                      !
                    </span>
                  )}
                </button>
              )
            })}
            {backupLinks.length > 0 && (
              <>
                <span className="font-medium text-slate-700">Backup:</span>
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-0.5 w-5 border-t-[3px] border-dashed"
                    style={{ borderColor: backupLineColor(1).stroke }}
                  />
                  резерв
                </span>
              </>
            )}
            <span className="flex items-center gap-1.5 text-slate-600">
              <span
                className="inline-block h-3 w-3 rounded-sm border-[3px]"
                style={{ borderColor: '#ca8a04' }}
              />
              ★ START
            </span>
            <span className="flex items-center gap-1.5 text-slate-600">
              <span
                className="inline-block h-3 w-3 rounded-sm border-[3px]"
                style={{ borderColor: END_LABEL_COLOR }}
              />
              End
            </span>
          </>
        ) : (
          <>
            <span className="font-medium text-slate-700">Power:</span>
            {usedLineNumbers.map((line) => {
              const c = lineColorFor(line)
              const hasWarning = warnedIds.has(line)
              return (
                <button
                  key={`leg-p-${line}`}
                  type="button"
                  disabled={!manualMode}
                  onClick={() => handleLegendClick(line)}
                  className={`${legendBtnClass} ${
                    manualMode
                      ? activeValue === line
                        ? 'bg-amber-100 ring-1 ring-amber-400'
                        : 'hover:bg-slate-100'
                      : ''
                  }`}
                >
                  <span
                    className="inline-block h-3 w-3 rounded-sm border-2"
                    style={{ backgroundColor: c.fill, borderColor: c.stroke }}
                  />
                  P{line}
                  {hasWarning && (
                    <span className="rounded bg-red-100 px-1 text-[9px] font-bold text-red-700">
                      !
                    </span>
                  )}
                </button>
              )
            })}
            <span className="flex items-center gap-1.5 text-slate-600">
              <span
                className="inline-block h-3 w-3 rounded-sm border-[3px]"
                style={{ borderColor: '#ca8a04' }}
              />
              ★ START (цепь)
            </span>
            <span className="flex items-center gap-1.5 text-slate-600">
              <span
                className="inline-block h-3 w-3 rounded-sm border-[3px]"
                style={{ borderColor: END_LABEL_COLOR }}
              />
              End
            </span>
            <span className="flex items-center gap-1.5 text-slate-600">
              <span
                className="inline-block h-3 w-3 rounded-sm border-[3px]"
                style={{ borderColor: TRUNK_FEED_COLOR }}
              />
              FEED (trunk)
            </span>
            <span className="text-slate-500">
              {powerFeedMode === 'center'
                ? 'Center: из центра экрана — линия влево и линия вправо'
                : 'Edge: FEED/START на краю, линия на всю ширину'}
            </span>
          </>
        )}
      </div>

      <div
        ref={gridScrollRef}
        className="-mx-1 overflow-x-auto px-1 pb-1 touch-pan-x"
      >
        <div
          className="mx-auto max-w-none bg-white"
          style={{
            width: svgW * effectiveScale,
            height: svgH * effectiveScale,
          }}
        >
          <svg
            width={svgW * effectiveScale}
            height={svgH * effectiveScale}
            viewBox={`0 0 ${svgW} ${svgH}`}
            className="block max-w-none"
            role="img"
            aria-label={isData ? 'Data port routing grid' : 'Power line routing grid'}
          >
        {stripWidths.length > 1 && (
          <g id="strip-labels" pointerEvents="none">
            {stripColumnRanges(stripWidths).map(({ index, startCol, endCol }) => {
              const x1 = cabLeft(startCol)
              const x2 = cabLeft(endCol - 1) + CELL_W
              const mid = (x1 + x2) / 2
              return (
                <text
                  key={`strip-lbl-${index}`}
                  x={mid}
                  y={Math.max(12, PAD - 10)}
                  textAnchor="middle"
                  fontSize={isMobile ? 9 : 11}
                  fontWeight={600}
                  fill="#64748b"
                >
                  Strip {index + 1}
                </text>
              )
            })}
          </g>
        )}
        <g id="cabinets">
          {cabinets.map((cab) => {
            const x = cabLeft(cab.col)
            const y = PAD + cab.row * (CELL_H + GAP)
            const isEmpty = emptySet.has(cab.label)
            const lineNum = isEmpty ? 0 : (assignmentMap.get(cab.label) ?? 0)
            const isSelected = selectedLabels.has(cab.label)
            const isStart = !isEmpty && startLabels.has(cab.label)
            const isFeed = !isEmpty && !isData && feedLabels.has(cab.label)
            const cabId = cabinetIdMap.get(cab.label)
            const idFont = isData
              ? cabId && cabId.length >= 7
                ? simplifyLabels || isMobile
                  ? 9
                  : 10
                : cabId && cabId.length >= 5
                  ? simplifyLabels || isMobile
                    ? 10
                    : 11
                  : simplifyLabels || isMobile
                    ? 11
                    : 12
              : cabId && cabId.length >= 7
                ? simplifyLabels || isMobile
                  ? 11
                  : 12
                : cabId && cabId.length >= 5
                  ? simplifyLabels || isMobile
                    ? 13
                    : 14
                  : simplifyLabels || isMobile
                    ? 15
                    : 16

            const lineColors = lineColorFor(lineNum)
            const isInteractive = manualMode || emptyPaintMode

            return (
              <g
                key={cab.label}
                onClick={(e) => handleCabinetClick(cab.label, e.shiftKey, e.altKey)}
                style={{ cursor: isInteractive ? 'pointer' : 'default' }}
              >
                <rect
                  x={x}
                  y={y}
                  width={CELL_W}
                  height={CELL_H}
                  rx={6}
                  fill={
                    isEmpty
                      ? '#f1f5f9'
                      : lineNum > 0
                        ? lineColors.fill
                        : COLORS.cabinetFill
                  }
                  stroke={
                    isEmpty
                      ? '#94a3b8'
                      : isFeed
                        ? TRUNK_FEED_COLOR
                        : isStart
                          ? '#eab308'
                          : isSelected
                            ? '#f59e0b'
                            : lineNum > 0
                              ? lineColors.stroke
                              : COLORS.cabinetStroke
                  }
                  strokeWidth={
                    isEmpty ? 2 : isFeed ? 4 : isStart ? 4 : isSelected ? 3.5 : lineNum > 0 ? 2.5 : 1.5
                  }
                  strokeDasharray={isEmpty ? '6 4' : undefined}
                />
                {isEmpty ? (
                  <>
                    <text
                      x={x + CELL_W / 2}
                      y={y + CELL_H / 2 - 4}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={700}
                      fill="#64748b"
                      pointerEvents="none"
                    >
                      EMPTY
                    </text>
                    <text
                      x={x + CELL_W / 2}
                      y={y + CELL_H / 2 + 10}
                      textAnchor="middle"
                      fontSize={9}
                      fill="#94a3b8"
                      pointerEvents="none"
                    >
                      {cab.label}
                    </text>
                  </>
                ) : (
                  <>
                {cabId ? (
                  <>
                    <text
                      x={x + CELL_W / 2}
                      y={y + CELL_H / 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={idFont}
                      fontWeight={isData ? 700 : 800}
                      fill={lineColors.label}
                      pointerEvents="none"
                    >
                      {cabId}
                    </text>
                    {!simplifyLabels && (
                      <text
                        x={x + CELL_W / 2}
                        y={y + CELL_H - 5}
                        textAnchor="middle"
                        fontSize={8}
                        fontWeight={500}
                        fill={COLORS.cabinetText}
                        opacity={0.55}
                        pointerEvents="none"
                      >
                        {cab.label}
                      </text>
                    )}
                  </>
                ) : (
                  <text
                    x={x + CELL_W / 2}
                    y={y + CELL_H / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={14}
                    fontWeight={700}
                    fill={COLORS.cabinetText}
                    pointerEvents="none"
                  >
                    {cab.label}
                  </text>
                )}
                {/* D/P бейдж только на START (см. start-markers) */}
                  </>
                )}
              </g>
            )
          })}
        </g>

        <g id="arrows">
          {!isData &&
            powerLinks.map((link, i) => {
              const from = cabCenter(link.from.col, link.from.row)
              const to = cabCenter(link.to.col, link.to.row)
              const colors = lineColorFor(link.chainId)
              const isVert = link.direction === 'vertical'
              const yMag = isMobile ? POWER_LANE_OFFSET.mobile : POWER_LANE_OFFSET.desktop
              const xInset = isMobile
                ? POWER_VERTICAL_INSET.mobile
                : POWER_VERTICAL_INSET.desktop
              const previousLink = powerLinks[i - 1]
              const nextLink = powerLinks[i + 1]
              const previousInChain =
                previousLink?.chainId === link.chainId &&
                previousLink.to.label === link.from.label
                  ? previousLink
                  : undefined
              const nextInChain =
                nextLink?.chainId === link.chainId &&
                nextLink.from.label === link.to.label
                  ? nextLink
                  : undefined
              const previousHorizontal =
                previousInChain?.direction === 'horizontal' ? previousInChain : undefined
              const nextHorizontal =
                nextInChain?.direction === 'horizontal' ? nextInChain : undefined
              const col = (link.from.col + link.to.col) / 2
              // На повороте вертикаль остаётся у того края кубика, где закончился
              // предыдущий горизонтальный ход (или начинается следующий).
              const towardRight = previousHorizontal
                ? previousHorizontal.to.col > previousHorizontal.from.col
                : nextHorizontal
                  ? nextHorizontal.to.col < nextHorizontal.from.col
                  : col >= wide / 2
              let offset = 0
              if (isVert) {
                const dy = to.y - from.y
                if (Math.abs(dy) > 0.5) {
                  offset = offsetForDesiredNx(
                    from.x,
                    from.y,
                    to.x,
                    to.y,
                    (towardRight ? 1 : -1) * (CELL_W / 2 - xInset),
                  )
                }
              } else {
                const dx = to.x - from.x
                const dy = to.y - from.y
                const len = Math.sqrt(dx * dx + dy * dy) || 1
                if (Math.abs(dx) > 0.5) {
                  // Выше цифр независимо от LTR/RTL сегмента
                  offset = (-yMag * len) / dx
                }
              }
              return (
                <ArrowPath
                  key={`pwr-${i}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  color={colors.arrow}
                  offset={Number.isFinite(offset) ? offset : 0}
                  isVertical={isVert}
                  isMobile={isMobile}
                />
              )
            })}

          {isData &&
            dataChains
              .filter((c) => !c.isBackup && c.cabinets.length >= 2)
              .flatMap((chain) => {
                const colors = lineColorFor(chain.portNumber)
                return splitAutoChainByStrips(
                  chain.cabinets,
                  stripWidths,
                  manualMode,
                ).map((segment, segmentIndex) => (
                  <MidContinuousChain
                    key={`dat-mid-${chain.portNumber}-${segmentIndex}`}
                    points={buildSmoothLanePoints(
                      segment,
                      cabCenter,
                      'data',
                      wide,
                      CELL_W,
                      isRtl,
                      isMobile,
                    )}
                    color={MID_LINE_COLOR}
                    arrowColor={colors.arrow}
                    isMobile={isMobile}
                  />
                ))
              })}

          {isData &&
            backupChains
              .filter((c) => c.cabinets.length >= 2)
              .flatMap((chain) =>
                splitAutoChainByStrips(
                  chain.cabinets,
                  stripWidths,
                  manualMode,
                ).map((segment, segmentIndex) => (
                  <MidContinuousChain
                    key={`bkp-mid-${chain.portNumber}-${segmentIndex}`}
                    points={buildSmoothLanePoints(
                      segment,
                      cabCenter,
                      'backup',
                      wide,
                      CELL_W,
                      isRtl,
                      isMobile,
                    )}
                    color={MID_BACKUP_LINE_COLOR}
                    arrowColor={backupLineColor(chain.portNumber).arrow}
                    isMobile={isMobile}
                    dashed
                  />
                )),
              )}

        </g>

        <g id="start-markers" pointerEvents="none">
          {cabinets.map((cab) => {
            if (emptySet.has(cab.label) || !startLabels.has(cab.label)) return null
            const x = cabLeft(cab.col)
            const y = PAD + cab.row * (CELL_H + GAP)
            const lineNum =
              startLineByLabel.get(cab.label) ?? assignmentMap.get(cab.label) ?? 0
            const lineColors = lineColorFor(lineNum)
            const lineId = lineNum > 0 ? formatLineId(lineNum) : prefix
            // Крупный бейдж: читается на телефоне и при fitScale сетки 14×8
            const badgeFont =
              simplifyLabels || isMobile ? (isMobile && simplifyLabels ? 15 : 13) : 11
            const badgePadX = simplifyLabels || isMobile ? 6 : 5
            const badgeH = badgeFont + (simplifyLabels || isMobile ? 8 : 6)
            const badgeW = Math.max(
              Math.ceil(lineId.length * badgeFont * 0.68) + badgePadX * 2,
              simplifyLabels || isMobile ? 34 : 28,
            )
            const badgeX = isRtl ? x + CELL_W - badgeW - 2 : x + 2
            const badgeY = y + 2
            const starSize = simplifyLabels || isMobile ? 15 : 18
            const starX = isRtl ? x + 12 : x + CELL_W - 12
            const starY = y + 13
            const labelSize = simplifyLabels || isMobile ? 9 : 11
            const isAlsoFeed = !isData && feedLabels.has(cab.label)
            const isAlsoEnd = endLabels.has(cab.label)
            return (
              <g key={`start-${cab.label}`}>
                <rect
                  x={badgeX}
                  y={badgeY}
                  width={badgeW}
                  height={badgeH}
                  rx={badgeH / 2}
                  fill={lineColors.stroke}
                  stroke="#ffffff"
                  strokeWidth={simplifyLabels || isMobile ? 2 : 1.5}
                />
                <text
                  x={badgeX + badgeW / 2}
                  y={badgeY + badgeH / 2 + badgeFont * 0.35}
                  textAnchor="middle"
                  fontSize={badgeFont}
                  fontWeight={800}
                  fill="#ffffff"
                  letterSpacing={0.5}
                >
                  {lineId}
                </text>
                <circle
                  cx={starX}
                  cy={starY}
                  r={simplifyLabels || isMobile ? 9 : 10.5}
                  fill="#fef3c7"
                  stroke="#b45309"
                  strokeWidth={2}
                />
                <text
                  x={starX}
                  y={starY + starSize * 0.35}
                  textAnchor="middle"
                  fontSize={starSize}
                  fontWeight={900}
                  fill="#b45309"
                  stroke="#ffffff"
                  strokeWidth={1}
                  paintOrder="stroke"
                >
                  ★
                </text>
                {/* START снизу; при FEED на том же кабинете подпись FEED/START уже есть */}
                {!isAlsoFeed && (
                  <text
                    x={x + CELL_W / 2}
                    y={y + CELL_H - (simplifyLabels || isMobile ? 5 : 6)}
                    textAnchor="middle"
                    fontSize={labelSize}
                    fontWeight={900}
                    fill="#92400e"
                    stroke="#ffffff"
                    strokeWidth={simplifyLabels || isMobile ? 2.5 : 3}
                    paintOrder="stroke"
                    letterSpacing={0.7}
                  >
                    {isAlsoEnd ? 'START/End' : 'START'}
                  </text>
                )}
              </g>
            )
          })}
        </g>

        <g id="feed-markers" pointerEvents="none">
          {!isData &&
            cabinets.map((cab) => {
              if (emptySet.has(cab.label) || !feedLabels.has(cab.label)) return null
              const x = cabLeft(cab.col)
              const y = PAD + cab.row * (CELL_H + GAP)
              const isAlsoStart = startLabels.has(cab.label)
              const isAlsoEnd = endLabels.has(cab.label)
              const labelSize = isAlsoStart
                ? simplifyLabels || isMobile
                  ? 9
                  : 11
                : simplifyLabels
                  ? 7
                  : 8
              const feedText = isAlsoStart
                ? isAlsoEnd
                  ? 'FEED/START/End'
                  : 'FEED/START'
                : isAlsoEnd
                  ? 'FEED/End'
                  : 'FEED'
              return (
                <g key={`feed-${cab.label}`}>
                  {!isAlsoStart && (
                    <circle
                      cx={x + CELL_W / 2}
                      cy={y + 10}
                      r={simplifyLabels ? 4 : 5}
                      fill={TRUNK_FEED_COLOR}
                      stroke="#ffffff"
                      strokeWidth={1.5}
                    />
                  )}
                  <text
                    x={x + CELL_W / 2}
                    y={y + CELL_H - 6}
                    textAnchor="middle"
                    fontSize={labelSize}
                    fontWeight={isAlsoStart ? 900 : 700}
                    fill={isAlsoStart ? '#92400e' : TRUNK_FEED_COLOR}
                    stroke="#ffffff"
                    strokeWidth={isAlsoStart ? 3 : simplifyLabels ? 2 : 1.5}
                    paintOrder="stroke"
                    letterSpacing={isAlsoStart ? 0.5 : undefined}
                  >
                    {feedText}
                  </text>
                </g>
              )
            })}
        </g>

        <g id="end-markers" pointerEvents="none">
          {cabinets.map((cab) => {
            if (emptySet.has(cab.label) || !endLabels.has(cab.label)) return null
            // На короткой линии Start/FEED уже показывают End в комбинированной подписи
            if (startLabels.has(cab.label) || feedLabels.has(cab.label)) return null
            const x = cabLeft(cab.col)
            const y = PAD + cab.row * (CELL_H + GAP)
            const endFont =
              simplifyLabels || isMobile ? (isMobile && simplifyLabels ? 12 : 10) : 8
            const badgePadX = simplifyLabels || isMobile ? 5 : 4
            const badgeH = endFont + (simplifyLabels || isMobile ? 6 : 4)
            const badgeW = Math.ceil(3 * endFont * 0.72) + badgePadX * 2
            const badgeX = x + (CELL_W - badgeW) / 2
            const badgeY = y + CELL_H - badgeH - 2
            return (
              <g key={`end-${cab.label}`}>
                <rect
                  x={badgeX}
                  y={badgeY}
                  width={badgeW}
                  height={badgeH}
                  rx={badgeH / 2}
                  fill={END_LABEL_COLOR}
                  stroke="#ffffff"
                  strokeWidth={simplifyLabels || isMobile ? 2 : 1.5}
                />
                <text
                  x={badgeX + badgeW / 2}
                  y={badgeY + badgeH / 2 + endFont * 0.35}
                  textAnchor="middle"
                  fontSize={endFont}
                  fontWeight={800}
                  fill="#ffffff"
                  letterSpacing={0.3}
                >
                  End
                </text>
              </g>
            )
          })}
        </g>

        <text x={PAD} y={svgH - 8} fontSize={11} fill="#94a3b8">
          {isData || isRtl
            ? 'Controller / PDU (control room side) →'
            : '← Controller / PDU (control room side)'}
          {' · '}
          {isData
            ? 'Snake / змейка (RTL / справа налево)'
            : isReshetPower
              ? 'Power ↑ только вверх (Reshet)'
              : is29Power
                ? 'Power ↑↓ вертикально (2.9)'
                : `Змейка power (${isRtl ? 'RTL' : 'LTR'} старт)`}
          {!isData && (
            <>
              {' · '}
              {powerFeedMode === 'center'
                ? 'Center: из центра экрана влево и вправо'
                : 'Edge: подвод с края (P★ FEED/START)'}
            </>
          )}
        </text>
          </svg>
        </div>
      </div>
    </div>
  )
})
