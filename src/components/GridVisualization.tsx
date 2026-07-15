import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  ChainStartEdge,
  ControllerModel,
  PitchPresetId,
  PowerFeedMode,
  RefreshRate,
  RoutingResult,
} from '../types'
import { edgeToDirection } from '../lib/cabinetGrid'
import { COLORS } from '../lib/constants'
import { inferDataChainStart } from '../lib/dataRouting'
import {
  capturePanelPng,
  panelExportFilename,
  type PanelPrintInfo,
  printPanelPng,
  sharePanelViaWhatsApp,
} from '../lib/panelExport'
import { CUSTOM_PRESET_LABEL, getPitchPreset } from '../lib/pitchPresets'
import { getPowerTrunkCabinet, inferPowerLineStart } from '../lib/powerRouting'
import {
  backupLineColor,
  dataLineColor,
  powerLineColor,
} from '../lib/lineColors'
import { maxRenumberLine } from '../lib/manualChains'

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
}

const DESKTOP_CELL = { w: 88, h: 64, gap: 12, pad: 40 }
const MOBILE_CELL = { w: 56, h: 44, gap: 6, pad: 24 }

const ZOOM_MIN = 0.5
const ZOOM_MAX = 3
const ZOOM_STEP = 0.1

const ARROW_STROKE = 4.5
const ARROW_OUTLINE = 7
const ARROW_HEAD_LEN = 14
const ARROW_HEAD_ANGLE = Math.PI / 5.5

const TRUNK_FEED_COLOR = '#ea580c'

const LARGE_GRID_THRESHOLD = 100

function cabinetCenter(col: number, row: number, cellW: number, cellH: number, gap: number, pad: number) {
  return {
    x: pad + col * (cellW + gap) + cellW / 2,
    y: pad + row * (cellH + gap) + cellH / 2,
  }
}

/** Расстояние data/backup линий от центрального пути кабинетов (px) */
const DATA_LANE_OFFSET = 13

/**
 * Перпендикулярное смещение data/backup от центра сегмента в мировых координатах SVG.
 * Горизонталь: data выше (меньше y), backup ниже.
 * Вертикаль (переход между рядами): data левее, backup правее.
 */
function dataLaneOffset(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  kind: 'data' | 'backup',
): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  const mag = DATA_LANE_OFFSET

  if (Math.abs(dx) >= Math.abs(dy)) {
    // ny = (dx / len) * offset → data вверх (ny < 0), backup вниз (ny > 0)
    const desiredNy = kind === 'data' ? -mag : mag
    return (desiredNy * len) / dx
  }

  // nx = (-dy / len) * offset → data влево (nx < 0), backup вправо (nx > 0)
  const desiredNx = kind === 'data' ? -mag : mag
  return (desiredNx * len) / -dy
}

function ArrowPath({
  x1,
  y1,
  x2,
  y2,
  color,
  dashed = false,
  solid = false,
  offset = 0,
  isVertical = false,
  emphasizeHorizontal = false,
}: {
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  dashed?: boolean
  solid?: boolean
  offset?: number
  isVertical?: boolean
  emphasizeHorizontal?: boolean
}) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  const nx = (-dy / len) * offset
  const ny = (dx / len) * offset

  const sx = x1 + nx
  const sy = y1 + ny
  const ex = x2 + nx
  const ey = y2 + ny

  const shorten = 20
  const ratio = Math.max(0, (len - shorten) / len)
  const ax = sx + (dx / len) * (len * 0.12)
  const ay = sy + (dy / len) * (len * 0.12)
  const bx = sx + dx * ratio * 0.88
  const by = sy + dy * ratio * 0.88

  const angle = Math.atan2(ey - sy, ex - sx)
  const hx1 = bx - ARROW_HEAD_LEN * Math.cos(angle - ARROW_HEAD_ANGLE)
  const hy1 = by - ARROW_HEAD_LEN * Math.sin(angle - ARROW_HEAD_ANGLE)
  const hx2 = bx - ARROW_HEAD_LEN * Math.cos(angle + ARROW_HEAD_ANGLE)
  const hy2 = by - ARROW_HEAD_LEN * Math.sin(angle + ARROW_HEAD_ANGLE)

  return (
    <g pointerEvents="none">
      <line
        x1={ax}
        y1={ay}
        x2={bx}
        y2={by}
        stroke="#ffffff"
        strokeWidth={ARROW_OUTLINE}
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
          emphasizeHorizontal ? ARROW_STROKE + 1 : isVertical ? ARROW_STROKE - 1 : ARROW_STROKE
        }
        strokeDasharray={
          solid ? undefined : dashed || (isVertical && !emphasizeHorizontal) ? '7 5' : undefined
        }
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polygon
        points={`${bx},${by} ${hx1},${hy1} ${hx2},${hy2}`}
        fill={color}
        stroke="#ffffff"
        strokeWidth={1.5}
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
  onRenumberActiveLine,
  canUndo = false,
  maxAssignable = 1,
  chainStartEdge = 'left',
  pitchPreset = '3.9-small',
  powerFeedMode = 'edge',
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

  const { w: CELL_W, h: CELL_H, gap: GAP, pad: PAD } = isMobile ? MOBILE_CELL : DESKTOP_CELL
  const editBtnClass =
    'touch-manipulation min-h-[44px] rounded-md px-3 py-2 text-xs font-semibold transition active:scale-[0.98] sm:min-h-[36px] sm:px-2.5 sm:py-1'
  const legendBtnClass =
    'touch-manipulation flex min-h-[40px] items-center gap-1.5 rounded-md px-2.5 py-1.5 transition active:scale-[0.98] sm:min-h-0 sm:px-1 sm:py-0.5'
  const zoomBtnClass =
    'touch-manipulation flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-slate-200 bg-white text-base font-semibold text-slate-700 transition hover:bg-slate-50 active:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-[32px] sm:min-w-[32px] sm:text-sm'

  const { cabinets, dataChains, powerLines, dataLinks, backupLinks, powerLinks, warnings } =
    result

  const isData = mode === 'data'
  const lineDirection = edgeToDirection(chainStartEdge)
  const isRtl = lineDirection === 'rtl'
  const isReshetPower = !isData && pitchPreset === '3.9-reshet'
  const is29Power = !isData && pitchPreset === '2.9'

  const sequenceStepMap = useMemo(() => {
    const map = new Map<string, number>()
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
  }, [isData, dataChains, powerLines])

  const title = isData
    ? 'Data Ports / Тикшорет / תקשורת'
    : 'Power Lines / Электричество / חשמל'
  const prefix = isData ? 'D' : 'P'

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
  ])

  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set())
  const [activeValue, setActiveValue] = useState(1)
  const [lineNumberInput, setLineNumberInput] = useState('1')
  const [editMode, setEditMode] = useState<ManualEditMode>('assign')
  /** Чтобы Enter не вызывал apply дважды (keydown + blur) */
  const skipRenumberBlurRef = useRef(false)

  const maxLineNumber = useMemo(
    () => maxRenumberLine(chainOrder, maxAssignable),
    [chainOrder, maxAssignable],
  )

  useEffect(() => {
    setSelectedLabels(new Set())
    setActiveValue(1)
    setLineNumberInput('1')
    setEditMode('assign')
  }, [manualMode, wide, high, mode])

  useEffect(() => {
    setLineNumberInput(String(activeValue))
  }, [activeValue])

  const applyLineRenumber = useCallback(() => {
    const parsed = Number.parseInt(lineNumberInput, 10)
    if (
      Number.isNaN(parsed) ||
      parsed < 1 ||
      parsed > maxLineNumber ||
      parsed === activeValue
    ) {
      setLineNumberInput(String(activeValue))
      return
    }
    // Активная линия целиком (кнопка D1/P2), не выбранный кабинет
    onRenumberActiveLine?.(activeValue, parsed)
    setActiveValue(parsed)
    setSelectedLabels(new Set())
  }, [lineNumberInput, maxLineNumber, activeValue, onRenumberActiveLine])

  const emptySet = useMemo(() => new Set(emptyCabinets), [emptyCabinets])

  const svgW = PAD * 2 + wide * CELL_W + (wide - 1) * GAP
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

  const valueNumbers = useMemo(() => {
    const fromResult = isData
      ? [...new Set(dataChains.map((c) => c.portNumber))]
      : [...new Set(powerLines.map((l) => l.lineNumber))]
    const fromManual = [...new Set(Object.values(manualAssignments))]
    const combined = new Set([...fromResult, ...fromManual])
    for (let i = 1; i <= maxAssignable + 1; i++) combined.add(i)
    return [...combined].filter((n) => n >= 1).sort((a, b) => a - b)
  }, [isData, dataChains, powerLines, manualAssignments, maxAssignable])

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

  const startLabelForActive = effectiveStartPoints[activeValue]

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
      const lastInActive = (chainOrder[activeValue] ?? []).at(-1)
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

  return (
    <div
      className={`overflow-x-auto rounded-xl border bg-white p-3 shadow-sm sm:p-4 ${
        manualMode || emptyPaintMode
          ? 'border-amber-300 ring-1 ring-amber-200'
          : 'border-slate-200'
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
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
        <div className="sticky top-0 z-10 mb-3 space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 shadow-sm">
          <p className="font-semibold text-amber-950">
            {title} — Ручная схема
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Режим:</span>
            <button
              type="button"
              onClick={() => setEditMode('assign')}
              className={`${editBtnClass} ${
                editMode === 'assign'
                  ? 'bg-amber-600 text-white'
                  : 'bg-white text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100'
              }`}
            >
              Paint / Краска
            </button>
            {onUndoLast && (
              <button
                type="button"
                onClick={onUndoLast}
                disabled={!canUndo}
                className={`${editBtnClass} ${
                  canUndo
                    ? 'bg-white text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100'
                    : 'cursor-not-allowed bg-white/60 text-amber-400 ring-1 ring-amber-200'
                }`}
                title="Отменить последнее заполнение (Alt+клик)"
              >
                Undo / Отменить
              </button>
            )}
            {onReverseActiveLine && (
              <button
                type="button"
                onClick={() => onReverseActiveLine(activeValue)}
                disabled={(chainOrder[activeValue] ?? []).length < 2}
                className={`${editBtnClass} ${
                  (chainOrder[activeValue] ?? []).length >= 2
                    ? 'bg-white text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100'
                    : 'cursor-not-allowed bg-white/60 text-amber-400 ring-1 ring-amber-200'
                }`}
                title={`Перевернуть ${prefix}${activeValue}: первый кабинет станет последним`}
              >
                Reverse / Перевернуть / הפוך
              </button>
            )}
            {onClearActiveLine && (
              <button
                type="button"
                onClick={() => onClearActiveLine(activeValue)}
                disabled={(chainOrder[activeValue] ?? []).length === 0}
                className={`${editBtnClass} ${
                  (chainOrder[activeValue] ?? []).length > 0
                    ? 'bg-white text-red-700 ring-1 ring-red-300 hover:bg-red-50'
                    : 'cursor-not-allowed bg-white/60 text-red-300 ring-1 ring-red-200'
                }`}
                title={`Очистить ${prefix}${activeValue}: снять все кабинеты с линии`}
              >
                Clear line / Очистить линию / נקה שורה
              </button>
            )}
            <button
              type="button"
              onClick={() => setEditMode('start')}
              className={`${editBtnClass} ${
                editMode === 'start'
                  ? 'bg-amber-600 text-white'
                  : 'bg-white text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100'
              }`}
            >
              Set Start / Старт
            </button>
            <button
              type="button"
              onClick={() => setEditMode('empty')}
              className={`${editBtnClass} ${
                editMode === 'empty'
                  ? 'bg-green-600 text-white ring-1 ring-green-500'
                  : 'bg-white text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100'
              }`}
            >
              Empty / Пропуск
            </button>
            {onClearManual && (
              <button
                type="button"
                onClick={handleClearManual}
                className={`${editBtnClass} ml-auto bg-white text-red-700 ring-1 ring-red-300 hover:bg-red-50`}
                title={
                  isData
                    ? 'Удалить все назначения data-портов и точки старта'
                    : 'Удалить все назначения power-линий и точки старта'
                }
              >
                {isData ? 'Clear Data Lines / Сбросить data' : 'Clear Power Lines / Сбросить power'}
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{prefix}-линия:</span>
            {onRenumberActiveLine && (
              <label className="flex items-center gap-1.5">
                <span className="text-amber-800/90">Line # / Линия №</span>
                <input
                  type="number"
                  min={1}
                  max={maxLineNumber}
                  value={lineNumberInput}
                  onChange={(e) => setLineNumberInput(e.target.value)}
                  onBlur={() => {
                    if (skipRenumberBlurRef.current) {
                      skipRenumberBlurRef.current = false
                      return
                    }
                    applyLineRenumber()
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      skipRenumberBlurRef.current = true
                      applyLineRenumber()
                      ;(e.target as HTMLInputElement).blur()
                    } else if (e.key === 'Escape') {
                      setLineNumberInput(String(activeValue))
                      skipRenumberBlurRef.current = true
                      ;(e.target as HTMLInputElement).blur()
                    }
                  }}
                  className="w-14 rounded-md border border-amber-300 bg-white px-2 py-1 text-center text-xs font-semibold text-amber-950 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  title={`Перенумеровать всю активную линию ${prefix}${activeValue} (все кабинеты), Enter — применить, 1–${maxLineNumber}`}
                />
              </label>
            )}
            {valueNumbers.map((n) => (
              <button
                key={`sel-${n}`}
                type="button"
                onClick={() => setActiveValue(n)}
                className={`${editBtnClass} ${
                  activeValue === n
                    ? 'bg-amber-600 text-white'
                    : 'bg-white text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100'
                }`}
              >
                {prefix}{n}
                {editMode === 'start' && effectiveStartPoints[n] && (
                  <span className="ml-1 text-[9px] opacity-80">★{effectiveStartPoints[n]}</span>
                )}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setActiveValue(maxAssignable + 1)}
              className={`${editBtnClass} ${
                activeValue === maxAssignable + 1
                  ? 'bg-amber-600 text-white'
                  : 'bg-white text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100'
              }`}
            >
              + New {prefix}{maxAssignable + 1}
            </button>
            {editMode === 'assign' && selectedLabels.size > 0 && (
              <button
                type="button"
                onClick={() => assignTo([...selectedLabels], activeValue)}
                className={`${editBtnClass} bg-amber-600 text-white hover:bg-amber-700`}
              >
                Apply to {selectedLabels.size} selected
              </button>
            )}
          </div>
          <p className="text-amber-800/90">
            Активно: <strong>{prefix}{activeValue}</strong>
            {editMode === 'assign' ? (
              <>
                {' '}
                — клики задают порядок цепочки; повторный клик по последнему снимает его;
                Undo / Alt+клик — отменить последнее; Reverse — первый кабинет станет последним;
                Clear line — снять все кабинеты с активной линии; Line # — перенумеровать
                всю активную линию (все кубики; если целевая занята — обмен).
              </>
            ) : editMode === 'start' ? (
              <>
                {' '}
                — клик по любому кабинету задаёт START для {prefix}
                {activeValue}: бейдж {prefix}
                {activeValue} и ★ переезжают туда (кабинет добавляется в начало линии, если ещё не
                был).
              </>
            ) : (
              <> — клик помечает пустой кабинет (исключается из маршрута).</>
            )}
            {startLabelForActive && (
              <span className="ml-1 font-semibold text-amber-700">
                (старт: {startLabelForActive})
              </span>
            )}
          </p>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600">
        {isData ? (
          <>
            <span className="font-medium text-slate-700">Data:</span>
            {valueNumbers.map((port) => {
              const c = dataLineColor(port)
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
                  D{port}
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
          </>
        ) : (
          <>
            <span className="font-medium text-slate-700">Power:</span>
            {valueNumbers.map((line) => {
              const c = powerLineColor(line)
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
                style={{ borderColor: TRUNK_FEED_COLOR }}
              />
              FEED (trunk)
            </span>
            <span className="text-slate-500">
              {powerFeedMode === 'center'
                ? 'Center: FEED/START в центре полосы, стрелки от центра'
                : 'Edge: FEED/START на краю полосы (по Line Direction)'}
            </span>
          </>
        )}
      </div>

      <div
        ref={gridScrollRef}
        className="-mx-1 overflow-x-auto px-1 pb-1 touch-pan-x"
      >
        <div
          ref={captureRef}
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
        <g id="cabinets">
          {cabinets.map((cab) => {
            const x = PAD + cab.col * (CELL_W + GAP)
            const y = PAD + cab.row * (CELL_H + GAP)
            const isEmpty = emptySet.has(cab.label)
            const lineNum = isEmpty ? 0 : (assignmentMap.get(cab.label) ?? 0)
            const isSelected = selectedLabels.has(cab.label)
            const isStart = !isEmpty && startLabels.has(cab.label)
            const isFeed = !isEmpty && !isData && feedLabels.has(cab.label)
            const step = sequenceStepMap.get(cab.label)

            const dataColors = dataLineColor(lineNum)
            const pwrColors = powerLineColor(lineNum)
            const lineColors = isData ? dataColors : pwrColors
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
                {step != null && step > 0 && !simplifyLabels && !isStart && (
                  <text
                    x={isRtl ? x + CELL_W - 10 : x + 10}
                    y={y + 14}
                    textAnchor={isRtl ? 'end' : 'start'}
                    fontSize={10}
                    fontWeight={700}
                    fill={lineColors.stroke}
                    pointerEvents="none"
                  >
                    {step}
                  </text>
                )}
                <text
                  x={x + CELL_W / 2}
                  y={y + CELL_H / 2 - (simplifyLabels ? 0 : 6)}
                  textAnchor="middle"
                  fontSize={14}
                  fontWeight={700}
                  fill={COLORS.cabinetText}
                  pointerEvents="none"
                >
                  {cab.label}
                </text>
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
              const from = cabinetCenter(link.from.col, link.from.row, CELL_W, CELL_H, GAP, PAD)
              const to = cabinetCenter(link.to.col, link.to.row, CELL_W, CELL_H, GAP, PAD)
              const color = powerLineColor(link.chainId).stroke
              return (
                <ArrowPath
                  key={`pwr-${i}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  color={color}
                  offset={
                    link.direction === 'vertical'
                      ? isReshetPower
                        ? 0
                        : isRtl
                          ? -10
                          : 10
                      : is29Power
                        ? isRtl
                          ? -6
                          : 6
                        : 0
                  }
                  isVertical={link.direction === 'vertical' || isReshetPower}
                  solid
                />
              )
            })}

          {isData &&
            dataLinks.map((link, i) => {
              const from = cabinetCenter(link.from.col, link.from.row, CELL_W, CELL_H, GAP, PAD)
              const to = cabinetCenter(link.to.col, link.to.row, CELL_W, CELL_H, GAP, PAD)
              const color = dataLineColor(link.chainId).stroke
              return (
                <ArrowPath
                  key={`dat-${i}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  color={color}
                  offset={dataLaneOffset(from.x, from.y, to.x, to.y, 'data')}
                  isVertical={link.direction === 'vertical'}
                  emphasizeHorizontal={link.direction === 'horizontal'}
                />
              )
            })}

          {isData &&
            backupLinks.map((link, i) => {
              const from = cabinetCenter(link.from.col, link.from.row, CELL_W, CELL_H, GAP, PAD)
              const to = cabinetCenter(link.to.col, link.to.row, CELL_W, CELL_H, GAP, PAD)
              const color = backupLineColor(link.chainId).stroke
              return (
                <ArrowPath
                  key={`bkp-${i}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  color={color}
                  dashed
                  offset={dataLaneOffset(from.x, from.y, to.x, to.y, 'backup')}
                  isVertical={link.direction === 'vertical'}
                />
              )
            })}
        </g>

        <g id="start-markers" pointerEvents="none">
          {cabinets.map((cab) => {
            if (emptySet.has(cab.label) || !startLabels.has(cab.label)) return null
            const x = PAD + cab.col * (CELL_W + GAP)
            const y = PAD + cab.row * (CELL_H + GAP)
            const lineNum =
              startLineByLabel.get(cab.label) ?? assignmentMap.get(cab.label) ?? 0
            const lineColors = isData
              ? dataLineColor(lineNum)
              : powerLineColor(lineNum)
            const lineId = lineNum > 0 ? `${prefix}${lineNum}` : prefix
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
            const starSize = simplifyLabels ? 10 : 12
            const labelSize = simplifyLabels ? 7 : 8
            const isAlsoFeed = !isData && feedLabels.has(cab.label)
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
                <text
                  x={isRtl ? x + 8 : x + CELL_W - 8}
                  y={y + 14}
                  textAnchor={isRtl ? 'start' : 'end'}
                  fontSize={starSize}
                  fontWeight={700}
                  fill="#ca8a04"
                  stroke="#ffffff"
                  strokeWidth={simplifyLabels ? 2 : 1.5}
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
                    fontWeight={700}
                    fill="#ca8a04"
                    stroke="#ffffff"
                    strokeWidth={simplifyLabels ? 2 : 1}
                    paintOrder="stroke"
                  >
                    START
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
              const x = PAD + cab.col * (CELL_W + GAP)
              const y = PAD + cab.row * (CELL_H + GAP)
              const labelSize = simplifyLabels ? 7 : 8
              const isAlsoStart = startLabels.has(cab.label)
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
                    fontWeight={700}
                    fill={TRUNK_FEED_COLOR}
                    stroke="#ffffff"
                    strokeWidth={simplifyLabels ? 2 : 1.5}
                    paintOrder="stroke"
                  >
                    {isAlsoStart ? 'FEED/START' : 'FEED'}
                  </text>
                </g>
              )
            })}
        </g>

        <text x={PAD} y={svgH - 8} fontSize={11} fill="#94a3b8">
          {isRtl ? 'Controller / PDU (control room side) →' : '← Controller / PDU (control room side)'}
          {' · '}
          {isData
            ? `Snake / змейка (${isRtl ? 'RTL' : 'LTR'} старт)`
            : isReshetPower
              ? 'Power ↑ только вверх (Reshet)'
              : is29Power
                ? 'Power ↑↓ вертикально (2.9)'
                : `${isRtl ? 'RTL / справа налево' : 'LTR / слева направо'} (power)`}
          {!isData && (
            <>
              {' · '}
              {powerFeedMode === 'center'
                ? 'Center: подвод в центре полосы (P★ FEED/START)'
                : 'Edge: подвод на краю линии (P★ FEED/START)'}
            </>
          )}
        </text>
          </svg>
        </div>
      </div>
    </div>
  )
})
