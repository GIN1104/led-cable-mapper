import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChainStartEdge, PitchPresetId, RoutingResult } from '../types'
import { edgeToDirection } from '../lib/cabinetGrid'
import { COLORS } from '../lib/constants'
import {
  backupLineColor,
  dataLineColor,
  powerLineColor,
} from '../lib/lineColors'

export type GridVisualizationMode = 'data' | 'power'
export type ManualEditMode = 'assign' | 'start' | 'empty'

interface GridVisualizationProps {
  result: RoutingResult
  wide: number
  high: number
  mode: GridVisualizationMode
  manualMode?: boolean
  emptyCabinets?: string[]
  emptyPaintMode?: boolean
  onToggleEmpty?: (label: string) => void
  manualAssignments?: Record<string, number>
  startPoints?: Record<number, string>
  onAssign?: (labels: string[], value: number) => void
  onSetStartPoint?: (value: number, label: string) => void
  maxAssignable?: number
  chainStartEdge?: ChainStartEdge
  pitchPreset?: PitchPresetId
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

const LARGE_GRID_THRESHOLD = 100

function cabinetCenter(col: number, row: number, cellW: number, cellH: number, gap: number, pad: number) {
  return {
    x: pad + col * (cellW + gap) + cellW / 2,
    y: pad + row * (cellH + gap) + cellH / 2,
  }
}

function SimpleArrowPath({
  x1,
  y1,
  x2,
  y2,
  color,
  dashed = false,
}: {
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  dashed?: boolean
}) {
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={color}
      strokeWidth={2}
      strokeDasharray={dashed ? '6 4' : undefined}
      strokeLinecap="round"
      pointerEvents="none"
    />
  )
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
        strokeDasharray={dashed || (isVertical && !emphasizeHorizontal) ? '7 5' : undefined}
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
  manualMode = false,
  emptyCabinets = [],
  emptyPaintMode = false,
  onToggleEmpty,
  manualAssignments = {},
  startPoints = {},
  onAssign,
  onSetStartPoint,
  maxAssignable = 1,
  chainStartEdge = 'left',
  pitchPreset = '3.9-small',
}: GridVisualizationProps) {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches,
  )

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const { w: CELL_W, h: CELL_H, gap: GAP, pad: PAD } = isMobile ? MOBILE_CELL : DESKTOP_CELL
  const editBtnClass =
    'touch-manipulation min-h-[40px] rounded px-3 py-2 text-xs font-semibold transition sm:min-h-0 sm:px-2 sm:py-0.5'
  const legendBtnClass =
    'touch-manipulation flex min-h-[36px] items-center gap-1.5 rounded px-2 py-1.5 transition sm:min-h-0 sm:px-1 sm:py-0.5'
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

  const title = isData ? 'Data Ports' : 'Power Lines'
  const prefix = isData ? 'D' : 'P'

  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set())
  const [activeValue, setActiveValue] = useState(1)
  const [editMode, setEditMode] = useState<ManualEditMode>('assign')

  useEffect(() => {
    setSelectedLabels(new Set())
    setActiveValue(1)
    setEditMode('assign')
  }, [manualMode, wide, high, mode])

  const emptySet = useMemo(() => new Set(emptyCabinets), [emptyCabinets])

  const svgW = PAD * 2 + wide * CELL_W + (wide - 1) * GAP
  const svgH = PAD * 2 + high * CELL_H + (high - 1) * GAP + 30

  const gridScrollRef = useRef<HTMLDivElement>(null)
  const [fitScale, setFitScale] = useState(1)
  const [zoomLevel, setZoomLevel] = useState(1)

  const effectiveScale = fitScale * zoomLevel
  const zoomPercent = Math.round(zoomLevel * 100)
  const totalCells = wide * high
  const simplifyArrows = totalCells > LARGE_GRID_THRESHOLD || effectiveScale < 0.8
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
    if (manualMode) return startPoints
    const map: Record<number, string> = {}
    if (isData) {
      for (const chain of dataChains) {
        if (!chain.isBackup && chain.cabinets.length > 0) {
          map[chain.portNumber] = chain.cabinets[0].label
        }
      }
    } else {
      for (const line of powerLines) {
        if (line.cabinets.length > 0) {
          map[line.lineNumber] = line.cabinets[0].label
        }
      }
    }
    return map
  }, [manualMode, startPoints, isData, dataChains, powerLines])

  const startLabelForActive = effectiveStartPoints[activeValue]

  const startLabels = useMemo(() => {
    const set = new Set<string>()
    for (const label of Object.values(effectiveStartPoints)) {
      if (label) set.add(label)
    }
    return set
  }, [effectiveStartPoints])

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
    (label: string, shiftKey: boolean) => {
      // Глобальный Empty из сайдбара не блокирует Paint/Set Start в ручном режиме
      const sidebarEmptyOnly =
        emptyPaintMode && (!manualMode || editMode === 'empty')

      if (sidebarEmptyOnly && onToggleEmpty) {
        onToggleEmpty(label)
        return
      }

      if (!manualMode) return

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

      assignTo([label], activeValue)
    },
    [manualMode, emptyPaintMode, onToggleEmpty, editMode, onSetStartPoint, selectedLabels, activeValue, assignTo],
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

  return (
    <div
      className={`overflow-x-auto rounded-xl border bg-white p-3 shadow-sm sm:p-4 ${
        manualMode || emptyPaintMode
          ? 'border-amber-300 ring-1 ring-amber-200'
          : 'border-slate-200'
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {(manualMode || emptyPaintMode) && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
              {emptyPaintMode && (!manualMode || editMode === 'empty')
                ? 'EMPTY MODE'
                : 'EDIT MODE'}
            </span>
          )}
        </div>
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
        <div className="mb-3 space-y-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Mode:</span>
            <button
              type="button"
              onClick={() => setEditMode('assign')}
              className={`${editBtnClass} ${
                editMode === 'assign'
                  ? 'bg-amber-600 text-white'
                  : 'bg-white text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100'
              }`}
            >
              Paint
            </button>
            <button
              type="button"
              onClick={() => setEditMode('start')}
              className={`${editBtnClass} ${
                editMode === 'start'
                  ? 'bg-amber-600 text-white'
                  : 'bg-white text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100'
              }`}
            >
              Set Start
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
              Empty / Пропущенный
            </button>
          </div>
          <p>
            Active: <strong>{prefix}{activeValue}</strong>
            {editMode === 'assign' ? (
              <> — click cabinet to paint, Shift+click to multi-select.</>
            ) : editMode === 'start' ? (
              <> — click cabinet to set as START for {prefix}{activeValue}.</>
            ) : (
              <> — click cabinet to toggle empty (skip routing).</>
            )}
            {startLabelForActive && (
              <span className="ml-1 font-semibold text-amber-700">
                (start: {startLabelForActive})
              </span>
            )}
          </p>
          {editMode === 'assign' && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Assign:</span>
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
            {selectedLabels.size > 0 && (
              <button
                type="button"
                onClick={() => assignTo([...selectedLabels], activeValue)}
                className={`${editBtnClass} bg-amber-600 text-white hover:bg-amber-700`}
              >
                Apply to {selectedLabels.size} selected
              </button>
            )}
          </div>
          )}
          {editMode === 'start' && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Line:</span>
            {valueNumbers.map((n) => (
              <button
                key={`start-${n}`}
                type="button"
                onClick={() => setActiveValue(n)}
                className={`${editBtnClass} ${
                  activeValue === n
                    ? 'bg-amber-600 text-white'
                    : 'bg-white text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100'
                }`}
              >
                {prefix}{n}
                {effectiveStartPoints[n] && (
                  <span className="ml-1 text-[9px] opacity-80">★{effectiveStartPoints[n]}</span>
                )}
              </button>
            ))}
          </div>
          )}
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
          </>
        )}
      </div>

      <div
        ref={gridScrollRef}
        className="-mx-1 overflow-x-auto px-1 pb-1 touch-pan-x"
      >
        <div
          className="mx-auto max-w-none"
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
            const step = sequenceStepMap.get(cab.label)

            const dataColors = dataLineColor(lineNum)
            const pwrColors = powerLineColor(lineNum)
            const lineColors = isData ? dataColors : pwrColors
            const lineLabel = isData ? `D${lineNum}` : `P${lineNum}`
            const isInteractive = manualMode || emptyPaintMode

            return (
              <g
                key={cab.label}
                onClick={(e) => handleCabinetClick(cab.label, e.shiftKey)}
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
                      : isStart
                        ? '#eab308'
                        : isSelected
                          ? '#f59e0b'
                          : lineNum > 0
                            ? lineColors.stroke
                            : COLORS.cabinetStroke
                  }
                  strokeWidth={
                    isEmpty ? 2 : isStart ? 4 : isSelected ? 3.5 : lineNum > 0 ? 2.5 : 1.5
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
                {isStart && !simplifyLabels && (
                  <text
                    x={isRtl ? x + 8 : x + CELL_W - 8}
                    y={y + 14}
                    textAnchor={isRtl ? 'start' : 'end'}
                    fontSize={12}
                    fill="#ca8a04"
                    pointerEvents="none"
                  >
                    ★
                  </text>
                )}
                {step != null && step > 0 && !simplifyLabels && (
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
                  y={y + CELL_H / 2 - (isStart ? 2 : 6)}
                  textAnchor="middle"
                  fontSize={14}
                  fontWeight={700}
                  fill={COLORS.cabinetText}
                  pointerEvents="none"
                >
                  {cab.label}
                </text>
                {isStart && !simplifyLabels && (
                  <text
                    x={x + CELL_W / 2}
                    y={y + CELL_H / 2 + 8}
                    textAnchor="middle"
                    fontSize={8}
                    fontWeight={700}
                    fill="#ca8a04"
                    pointerEvents="none"
                  >
                    START
                  </text>
                )}
                {!simplifyLabels && (
                <text
                  x={x + CELL_W / 2}
                  y={y + CELL_H / 2 + (isStart ? 18 : 10)}
                  textAnchor="middle"
                  fontSize={9}
                  fontWeight={600}
                  fill={lineColors.label}
                  pointerEvents="none"
                >
                  {lineLabel}
                </text>
                )}
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
              if (simplifyArrows) {
                return (
                  <SimpleArrowPath
                    key={`pwr-${i}`}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    color={color}
                  />
                )
              }
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
                />
              )
            })}

          {isData &&
            backupLinks.map((link, i) => {
              const from = cabinetCenter(link.from.col, link.from.row, CELL_W, CELL_H, GAP, PAD)
              const to = cabinetCenter(link.to.col, link.to.row, CELL_W, CELL_H, GAP, PAD)
              const color = backupLineColor(link.chainId).stroke
              if (simplifyArrows) {
                return (
                  <SimpleArrowPath
                    key={`bkp-${i}`}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    color={color}
                    dashed
                  />
                )
              }
              return (
                <ArrowPath
                  key={`bkp-${i}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  color={color}
                  dashed
                  offset={12}
                  isVertical={link.direction === 'vertical'}
                />
              )
            })}

          {isData &&
            dataLinks.map((link, i) => {
              const from = cabinetCenter(link.from.col, link.from.row, CELL_W, CELL_H, GAP, PAD)
              const to = cabinetCenter(link.to.col, link.to.row, CELL_W, CELL_H, GAP, PAD)
              const color = dataLineColor(link.chainId).stroke
              if (simplifyArrows) {
                return (
                  <SimpleArrowPath
                    key={`dat-${i}`}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    color={color}
                  />
                )
              }
              return (
                <ArrowPath
                  key={`dat-${i}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  color={color}
                  offset={
                    link.direction === 'horizontal'
                      ? isRtl
                        ? 12
                        : -12
                      : isRtl
                        ? -8
                        : 8
                  }
                  isVertical={link.direction === 'vertical'}
                  emphasizeHorizontal={link.direction === 'horizontal'}
                />
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
        </text>
          </svg>
        </div>
      </div>
    </div>
  )
})
