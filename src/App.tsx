import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GridLayout, ScreenConfig, ScreenRoutingState } from './types'
import {
  createScreen,
  DEFAULT_PROJECT,
  EMPTY_MANUAL_OVERRIDES,
  EMPTY_SCREEN_ROUTING,
} from './types'
import { buildAutoManualOverrides } from './lib/routingEngine'
import { buildCombinedPackingList } from './lib/packingList'
import { syncCabinetGridFromMeters, calcPixelsPerCabinet, normalizeStripWidths } from './lib/cabinetGrid'
import { refreshStripPitchSnapshots, resolveAllStripPitches } from './lib/stripPitch'
import {
  remapDataPortControllers,
  inferControllerFromLabel,
} from './lib/dualVxRouting'
import { remapLineColorOverrides } from './lib/lineColorAssignment'
import {
  appendLabelToChain,
  clearChain,
  moveLabelToChainFront,
  removeLabelFromChains,
  renumberLine,
  reverseChain,
} from './lib/manualChains'
import {
  getMaxCabinetsPerDataPort,
  getPowerLineLimitHint,
  getMaxPixelsPerDataPort,
  HIGH_PIXEL_SCREEN_THRESHOLD,
  needsHighPixelController,
} from './lib/constants'
import { isLargeGrid, fullRoutingKey } from './lib/screenConfigHash'
import { useActiveRouting, useAllScreensRouting } from './hooks/useRoutingResults'
import Sidebar from './components/Sidebar'
import GridVisualization from './components/GridVisualization'
import RoutingSchema from './components/RoutingSchema'
import CableScheduleTable from './components/CableScheduleTable'
import PackingListView from './components/PackingListView'
import EquipmentListTable from './components/EquipmentListTable'
import RoutingSpinner from './components/RoutingSpinner'
import {
  buildEquipmentListState,
  downloadEquipmentListXlsx,
  resolveEquipmentScreenResults,
} from './lib/equipmentList'
import type { EquipmentListState } from './lib/equipmentList'

type ManualOverrides = ScreenRoutingState['manualOverrides']
type DataUndoSnapshot = Pick<
  ManualOverrides,
  | 'dataPorts'
  | 'dataStartPoints'
  | 'dataPortChains'
  | 'dataPortControllers'
  | 'dataPortColors'
>
type PowerUndoSnapshot = Pick<
  ManualOverrides,
  'powerLines' | 'powerStartPoints' | 'powerLineChains' | 'powerLineColors'
>

const MANUAL_UNDO_LIMIT = 100

/** Полный снимок ручной data-схемы перед одним действием пользователя. */
function snapshotDataManual(state: ScreenRoutingState): DataUndoSnapshot {
  return {
    dataPorts: { ...state.manualOverrides.dataPorts },
    dataStartPoints: { ...state.manualOverrides.dataStartPoints },
    dataPortChains: Object.fromEntries(
      Object.entries(state.manualOverrides.dataPortChains ?? {}).map(([key, labels]) => [
        Number(key),
        [...labels],
      ]),
    ),
    dataPortControllers: { ...(state.manualOverrides.dataPortControllers ?? {}) },
    dataPortColors: { ...(state.manualOverrides.dataPortColors ?? {}) },
  }
}

/** Полный снимок ручной power-схемы перед одним действием пользователя. */
function snapshotPowerManual(state: ScreenRoutingState): PowerUndoSnapshot {
  return {
    powerLines: { ...state.manualOverrides.powerLines },
    powerStartPoints: { ...state.manualOverrides.powerStartPoints },
    powerLineChains: Object.fromEntries(
      Object.entries(state.manualOverrides.powerLineChains ?? {}).map(([key, labels]) => [
        Number(key),
        [...labels],
      ]),
    ),
    powerLineColors: { ...(state.manualOverrides.powerLineColors ?? {}) },
  }
}
function SummaryCard({
  label,
  value,
  sub,
}: {
  label: string
  value: string | number
  sub?: string
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 sm:text-[10px]">
        {label}
      </p>
      <p className="mt-0.5 text-lg font-bold text-slate-900 sm:text-xl">{value}</p>
      {sub && <p className="text-[10px] leading-snug text-slate-500">{sub}</p>}
    </div>
  )
}

function pruneEmptyFromGrid(emptyCabinets: string[], wide: number, high: number): string[] {
  const maxCol = wide - 1
  return emptyCabinets.filter((label) => {
    const match = /^([A-Z]+)(\d+)$/.exec(label)
    if (!match) return false
    const col = parseInt(match[2], 10) - 1
    let letterIndex = 0
    for (const ch of match[1]) {
      letterIndex = letterIndex * 26 + (ch.charCodeAt(0) - 64)
    }
    const row = high - 1 - (letterIndex - 1)
    return row >= 0 && row <= high - 1 && col >= 0 && col <= maxCol
  })
}

export default function App() {
  const [screens, setScreens] = useState<ScreenConfig[]>(DEFAULT_PROJECT.screens)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activeScreenId, setActiveScreenId] = useState(DEFAULT_PROJECT.activeScreenId)
  const [routingByScreen, setRoutingByScreen] = useState<Record<string, ScreenRoutingState>>({
    [DEFAULT_PROJECT.activeScreenId]: { ...EMPTY_SCREEN_ROUTING },
  })
  const [emptyPaintMode, setEmptyPaintMode] = useState(false)
  const [gridLayout, setGridLayout] = useState<GridLayout>('stacked')
  const [showCombinedPacking, setShowCombinedPacking] = useState(false)
  const [equipmentList, setEquipmentList] = useState<EquipmentListState | null>(null)
  /** История полных состояний — одно действие пользователя = один снимок. */
  const [dataPaintUndo, setDataPaintUndo] = useState<Record<string, DataUndoSnapshot[]>>({})
  const [powerPaintUndo, setPowerPaintUndo] = useState<Record<string, PowerUndoSnapshot[]>>({})

  const activeScreen = useMemo(
    () => screens.find((s) => s.id === activeScreenId) ?? screens[0],
    [screens, activeScreenId],
  )

  const activeRouting = routingByScreen[activeScreen.id] ?? EMPTY_SCREEN_ROUTING
  const { manualModeData, manualModePower, manualOverrides } = activeRouting
  const anyManual = manualModeData || manualModePower

  const pushDataUndo = useCallback(() => {
    const snapshot = snapshotDataManual(activeRouting)
    setDataPaintUndo((history) => ({
      ...history,
      [activeScreen.id]: [
        ...(history[activeScreen.id] ?? []),
        snapshot,
      ].slice(-MANUAL_UNDO_LIMIT),
    }))
  }, [activeRouting, activeScreen.id])

  const pushPowerUndo = useCallback(() => {
    const snapshot = snapshotPowerManual(activeRouting)
    setPowerPaintUndo((history) => ({
      ...history,
      [activeScreen.id]: [
        ...(history[activeScreen.id] ?? []),
        snapshot,
      ].slice(-MANUAL_UNDO_LIMIT),
    }))
  }, [activeRouting, activeScreen.id])

  const { result, autoResult, isRouting } = useActiveRouting(
    activeScreen,
    activeRouting,
    screens,
  )

  const needsAllScreens =
    screens.length > 1 || showCombinedPacking
  const allScreenResults = useAllScreensRouting(screens, routingByScreen, needsAllScreens)

  const pendingRoutingKey = useRef(fullRoutingKey(activeScreen, activeRouting))
  const [isMeterPending, setIsMeterPending] = useState(false)

  useEffect(() => {
    const nextKey = fullRoutingKey(activeScreen, activeRouting)
    if (nextKey !== pendingRoutingKey.current) {
      pendingRoutingKey.current = nextKey
      if (isLargeGrid(activeScreen)) {
        setIsMeterPending(true)
      }
    }
  }, [activeScreen, activeRouting])

  useEffect(() => {
    const currentKey = fullRoutingKey(activeScreen, activeRouting)
    if (result && !isRouting && currentKey === pendingRoutingKey.current) {
      setIsMeterPending(false)
    }
  }, [result, isRouting, activeScreen, activeRouting])

  const showInitialSpinner = isRouting || result == null
  const showRecalcOverlay = isMeterPending && result != null

  const prevGridSize = useRef(
    `${activeScreen.id}:${activeScreen.cabinetsWide}x${activeScreen.cabinetsHigh}`,
  )

  const globalTotals = useMemo(() => {
    if (screens.length <= 1) {
      return {
        totalCabinets: result?.summary.totalCabinets ?? 0,
        totalPixels: result?.summary.totalPixels ?? 0,
        totalEmpty: result?.summary.emptyCabinets ?? 0,
        screenCount: screens.length,
      }
    }
    let totalCabinets = 0
    let totalPixels = 0
    let totalEmpty = 0
    for (const { result: r } of allScreenResults) {
      totalCabinets += r.summary.totalCabinets
      totalPixels += r.summary.totalPixels
      totalEmpty += r.summary.emptyCabinets
    }
    return { totalCabinets, totalPixels, totalEmpty, screenCount: screens.length }
  }, [allScreenResults, screens.length, result])

  /** Сводка по каждому экрану: имя, резолюция, линии data/power */
  const screenSummaries = useMemo(() => {
    if (screens.length <= 1) return []
    return allScreenResults.map(({ screen, result: r }) => {
      const { pixelsWide, pixelsHigh } = calcPixelsPerCabinet(screen)
      const resW = screen.cabinetsWide * pixelsWide
      const resH = screen.cabinetsHigh * pixelsHigh
      return {
        id: screen.id,
        name: screen.name,
        resolution: `${resW.toLocaleString()}×${resH.toLocaleString()} px`,
        dataLines: r.summary.dataPorts,
        powerLines: r.summary.powerLines,
      }
    })
  }, [screens.length, allScreenResults])

  const combinedPackingList = useMemo(
    () =>
      buildCombinedPackingList(
        allScreenResults.map(({ screen, result: r }) => ({
          screenName: screen.name,
          items: r.packingList,
        })),
      ),
    [allScreenResults],
  )

  const combinedCableSchedule = useMemo(() => {
    const entries = []
    for (const { result: r } of allScreenResults) {
      entries.push(...r.cableSchedule)
    }
    return entries
  }, [allScreenResults])

  const equipmentCableSchedule = useMemo(
    () =>
      screens.length > 1 ? combinedCableSchedule : (result?.cableSchedule ?? []),
    [screens.length, combinedCableSchedule, result],
  )

  const equipmentPackingList = useMemo(
    () => (screens.length > 1 ? combinedPackingList : (result?.packingList ?? [])),
    [screens.length, combinedPackingList, result],
  )

  const equipmentScreenResults = useMemo(
    () =>
      resolveEquipmentScreenResults(
        allScreenResults,
        result ? { screen: activeScreen, result } : null,
      ),
    [allScreenResults, result, activeScreen],
  )

  const equipmentBuildKey = useMemo(() => {
    if (!result) return ''
    const screensPart = screens
      .map(
        (s) =>
          `${s.id}:${s.name}:${s.cabinetsWide}x${s.cabinetsHigh}:${s.wallWidthM}x${s.wallHeightM}:${s.controllerModel}:${s.dualVx1000 ? 1 : 0}:${s.hangMount ? 1 : 0}:${s.powerFeedMode}:${s.stripWidths?.join(',') ?? ''}:${s.stripHeights?.join(',') ?? ''}`,
      )
      .join('|')
    const resultsPart = equipmentScreenResults
      .map(
        ({ screen, result: r }) =>
          `${screen.id}:${r.summary.dataPorts}:${r.summary.backupPorts}:${r.summary.powerLines}:${r.summary.totalCabinets}:${r.cableSchedule.length}`,
      )
      .join('|')
    return `${screensPart}#${resultsPart}#${equipmentCableSchedule.length}#${equipmentPackingList.length}`
  }, [
    result,
    screens,
    equipmentScreenResults,
    equipmentCableSchedule.length,
    equipmentPackingList.length,
  ])

  const equipmentBuildKeyRef = useRef('')

  useEffect(() => {
    if (!result || !equipmentBuildKey) return
    if (equipmentBuildKeyRef.current === equipmentBuildKey) return
    equipmentBuildKeyRef.current = equipmentBuildKey
    setEquipmentList((prev) =>
      buildEquipmentListState(
        screens,
        equipmentScreenResults,
        equipmentCableSchedule,
        equipmentPackingList,
        prev ?? undefined,
      ),
    )
  }, [
    result,
    equipmentBuildKey,
    screens,
    equipmentScreenResults,
    equipmentCableSchedule,
    equipmentPackingList,
  ])

  const handleRefreshEquipmentList = useCallback(() => {
    if (!result) return
    setEquipmentList((prev) => {
      const customRows = prev?.customRows ?? []
      const next = buildEquipmentListState(
        screens,
        equipmentScreenResults,
        equipmentCableSchedule,
        equipmentPackingList,
        prev ? { meta: prev.meta, rows: [], customRows } : undefined,
      )
      return { ...next, customRows }
    })
  }, [result, screens, equipmentScreenResults, equipmentCableSchedule, equipmentPackingList])

  useEffect(() => {
    const gridKey = `${activeScreen.id}:${activeScreen.cabinetsWide}x${activeScreen.cabinetsHigh}`
    if (gridKey === prevGridSize.current) return

    prevGridSize.current = gridKey

    const applyGridChange = () => {
      setRoutingByScreen((prev) => {
        const current = prev[activeScreen.id] ?? EMPTY_SCREEN_ROUTING
        if (!current.manualModeData && !current.manualModePower) return prev
        const auto = buildAutoManualOverrides(activeScreen)
        return {
          ...prev,
          [activeScreen.id]: {
            ...current,
            manualOverrides: {
              dataPorts: current.manualModeData
                ? auto.dataPorts
                : current.manualOverrides.dataPorts,
              dataStartPoints: current.manualModeData
                ? auto.dataStartPoints
                : current.manualOverrides.dataStartPoints,
              dataPortChains: current.manualModeData
                ? auto.dataPortChains
                : current.manualOverrides.dataPortChains,
              powerLines: current.manualModePower
                ? auto.powerLines
                : current.manualOverrides.powerLines,
              powerStartPoints: current.manualModePower
                ? auto.powerStartPoints
                : current.manualOverrides.powerStartPoints,
              powerLineChains: current.manualModePower
                ? auto.powerLineChains
                : current.manualOverrides.powerLineChains,
            },
          },
        }
      })
      setDataPaintUndo((u) => ({ ...u, [activeScreen.id]: [] }))
      setPowerPaintUndo((u) => ({ ...u, [activeScreen.id]: [] }))
      setScreens((prev) =>
        prev.map((s) =>
          s.id === activeScreen.id
            ? {
                ...s,
                emptyCabinets: pruneEmptyFromGrid(
                  s.emptyCabinets,
                  s.cabinetsWide,
                  s.cabinetsHigh,
                ),
              }
            : s,
        ),
      )
    }

    if (isLargeGrid(activeScreen)) {
      const win = window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
        cancelIdleCallback?: (id: number) => void
      }
      if (win.requestIdleCallback) {
        const id = win.requestIdleCallback(applyGridChange, { timeout: 200 })
        return () => win.cancelIdleCallback?.(id)
      }
      const id = window.setTimeout(applyGridChange, 0)
      return () => window.clearTimeout(id)
    }

    applyGridChange()
  }, [activeScreen])

  const updateActiveScreen = useCallback((next: ScreenConfig) => {
    setScreens((prev) => {
      const synced = syncCabinetGridFromMeters(next)
      const withNext = prev.map((s) => (s.id === synced.id ? synced : s))
      // Если у полос питч с другого экрана — обновить снимки
      return withNext.map((s) => refreshStripPitchSnapshots(s, withNext))
    })
  }, [])

  const cloneScreenRouting = (state: ScreenRoutingState): ScreenRoutingState => ({
    manualModeData: state.manualModeData,
    manualModePower: state.manualModePower,
    manualOverrides: {
      dataPorts: { ...state.manualOverrides.dataPorts },
      powerLines: { ...state.manualOverrides.powerLines },
      dataStartPoints: { ...state.manualOverrides.dataStartPoints },
      powerStartPoints: { ...state.manualOverrides.powerStartPoints },
      dataPortChains: Object.fromEntries(
        Object.entries(state.manualOverrides.dataPortChains ?? {}).map(([k, v]) => [
          Number(k),
          [...v],
        ]),
      ),
      powerLineChains: Object.fromEntries(
        Object.entries(state.manualOverrides.powerLineChains ?? {}).map(([k, v]) => [
          Number(k),
          [...v],
        ]),
      ),
      dataPortControllers: { ...(state.manualOverrides.dataPortControllers ?? {}) },
      dataPortColors: { ...(state.manualOverrides.dataPortColors ?? {}) },
      powerLineColors: { ...(state.manualOverrides.powerLineColors ?? {}) },
    },
  })

  const setActiveRouting = useCallback(
    (patch: Partial<ScreenRoutingState>) => {
      setRoutingByScreen((prev) => ({
        ...prev,
        [activeScreen.id]: {
          ...cloneScreenRouting(prev[activeScreen.id] ?? EMPTY_SCREEN_ROUTING),
          ...patch,
        },
      }))
    },
    [activeScreen.id],
  )

  const handleManualModeDataChange = useCallback(
    (enabled: boolean) => {
      if (enabled) {
        const auto = buildAutoManualOverrides(activeScreen)
        setRoutingByScreen((prev) => {
          const current = prev[activeScreen.id] ?? EMPTY_SCREEN_ROUTING
          return {
            ...prev,
            [activeScreen.id]: {
              ...cloneScreenRouting(current),
              manualModeData: true,
              manualOverrides: {
                ...current.manualOverrides,
                dataPorts: auto.dataPorts,
                dataStartPoints: auto.dataStartPoints,
                dataPortChains: auto.dataPortChains,
              },
            },
          }
        })
        setDataPaintUndo((prev) => ({ ...prev, [activeScreen.id]: [] }))
      } else {
        setActiveRouting({ manualModeData: false })
      }
    },
    [activeScreen, setActiveRouting],
  )

  const handleManualModePowerChange = useCallback(
    (enabled: boolean) => {
      if (enabled) {
        const auto = buildAutoManualOverrides(activeScreen)
        setRoutingByScreen((prev) => {
          const current = prev[activeScreen.id] ?? EMPTY_SCREEN_ROUTING
          return {
            ...prev,
            [activeScreen.id]: {
              ...cloneScreenRouting(current),
              manualModePower: true,
              manualOverrides: {
                ...current.manualOverrides,
                powerLines: auto.powerLines,
                powerStartPoints: auto.powerStartPoints,
                powerLineChains: auto.powerLineChains,
              },
            },
          }
        })
        setPowerPaintUndo((prev) => ({ ...prev, [activeScreen.id]: [] }))
      } else {
        setActiveRouting({ manualModePower: false })
      }
    },
    [activeScreen, setActiveRouting],
  )

  const handleDataAssignment = useCallback(
    (labels: string[], portNumber: number) => {
      const screen = screens.find((s) => s.id === activeScreen.id) ?? activeScreen
      const emptySet = new Set(screen.emptyCabinets ?? [])
      const stripWidths = normalizeStripWidths(screen.stripWidths, screen.cabinetsWide)
      const painted = labels.filter((label) => !emptySet.has(label))
      if (painted.length === 0) return

      const paintedLabels = painted

      pushDataUndo()
      setRoutingByScreen((prev) => {
        const current = prev[activeScreen.id] ?? EMPTY_SCREEN_ROUTING
        let dataPorts = { ...current.manualOverrides.dataPorts }
        let dataPortChains = { ...(current.manualOverrides.dataPortChains ?? {}) }
        let dataStartPoints = { ...(current.manualOverrides.dataStartPoints ?? {}) }
        let dataPortControllers = {
          ...(current.manualOverrides.dataPortControllers ?? {}),
        }

        // START не двигаем при Paint — только через Set Start
        for (const label of paintedLabels) {
          for (const [port, start] of Object.entries(dataStartPoints)) {
            if (start === label && Number(port) !== portNumber) {
              delete dataStartPoints[Number(port)]
            }
          }
          dataPortChains = appendLabelToChain(dataPortChains, label, portNumber)
          dataPorts = { ...dataPorts, [label]: portNumber }
        }
        const chain = dataPortChains[portNumber] ?? []
        const lockedStart = dataStartPoints[portNumber]
        if (lockedStart && chain.includes(lockedStart)) {
          dataPortChains = moveLabelToChainFront(dataPortChains, lockedStart, portNumber)
        } else if (chain[0]) {
          dataStartPoints[portNumber] = chain[0]
        }

        // Dual VX: контроллер по стрипу первого кабинета линии
        if (screen.dualVx1000 && stripWidths.length > 1 && chain[0]) {
          const cid = inferControllerFromLabel(chain[0], screen)
          if (cid === 1 || cid === 2) dataPortControllers[portNumber] = cid
        }

        return {
          ...prev,
          [activeScreen.id]: {
            ...current,
            manualModeData: true,
            manualOverrides: {
              ...current.manualOverrides,
              dataPorts,
              dataPortChains,
              dataStartPoints,
              dataPortControllers,
            },
          },
        }
      })
    },
    [activeScreen, screens, pushDataUndo],
  )

  const handleSetDataPortController = useCallback(
    (portNumber: number, controllerId: 1 | 2) => {
      if (activeRouting.manualOverrides.dataPortControllers?.[portNumber] === controllerId) {
        return
      }
      pushDataUndo()
      setRoutingByScreen((prev) => {
        const current = prev[activeScreen.id] ?? EMPTY_SCREEN_ROUTING
        return {
          ...prev,
          [activeScreen.id]: {
            ...current,
            manualModeData: true,
            manualOverrides: {
              ...current.manualOverrides,
              dataPortControllers: {
                ...(current.manualOverrides.dataPortControllers ?? {}),
                [portNumber]: controllerId,
              },
            },
          },
        }
      })
    },
    [activeRouting, activeScreen.id, pushDataUndo],
  )

  const handleSetDataLineColor = useCallback(
    (portNumber: number, colorIndex: number) => {
      if (activeRouting.manualOverrides.dataPortColors?.[portNumber] === colorIndex) {
        return
      }
      pushDataUndo()
      setRoutingByScreen((prev) => {
        const current = prev[activeScreen.id] ?? EMPTY_SCREEN_ROUTING
        const prevColor = current.manualOverrides.dataPortColors?.[portNumber]
        if (prevColor === colorIndex) return prev
        return {
          ...prev,
          [activeScreen.id]: {
            ...current,
            manualOverrides: {
              ...current.manualOverrides,
              dataPortColors: {
                ...(current.manualOverrides.dataPortColors ?? {}),
                [portNumber]: colorIndex,
              },
            },
          },
        }
      })
    },
    [activeRouting, activeScreen.id, pushDataUndo],
  )

  const handleSetPowerLineColor = useCallback(
    (lineNumber: number, colorIndex: number) => {
      if (activeRouting.manualOverrides.powerLineColors?.[lineNumber] === colorIndex) {
        return
      }
      pushPowerUndo()
      setRoutingByScreen((prev) => {
        const current = prev[activeScreen.id] ?? EMPTY_SCREEN_ROUTING
        const prevColor = current.manualOverrides.powerLineColors?.[lineNumber]
        if (prevColor === colorIndex) return prev
        return {
          ...prev,
          [activeScreen.id]: {
            ...current,
            manualOverrides: {
              ...current.manualOverrides,
              powerLineColors: {
                ...(current.manualOverrides.powerLineColors ?? {}),
                [lineNumber]: colorIndex,
              },
            },
          },
        }
      })
    },
    [activeRouting, activeScreen.id, pushPowerUndo],
  )

  const handlePowerAssignment = useCallback(
    (labels: string[], lineNumber: number) => {
      const emptySet = new Set(
        screens.find((s) => s.id === activeScreen.id)?.emptyCabinets ?? [],
      )
      const painted = labels.filter((label) => !emptySet.has(label))
      if (painted.length === 0) return

      pushPowerUndo()
      setRoutingByScreen((prev) => {
        const current = prev[activeScreen.id] ?? EMPTY_SCREEN_ROUTING
        let powerLines = { ...current.manualOverrides.powerLines }
        let powerLineChains = { ...(current.manualOverrides.powerLineChains ?? {}) }
        let powerStartPoints = { ...(current.manualOverrides.powerStartPoints ?? {}) }
        // START не двигаем при Paint — только через Set Start
        for (const label of painted) {
          for (const [line, start] of Object.entries(powerStartPoints)) {
            if (start === label && Number(line) !== lineNumber) {
              delete powerStartPoints[Number(line)]
            }
          }
          powerLineChains = appendLabelToChain(powerLineChains, label, lineNumber)
          powerLines = { ...powerLines, [label]: lineNumber }
        }
        const chain = powerLineChains[lineNumber] ?? []
        const lockedStart = powerStartPoints[lineNumber]
        if (lockedStart && chain.includes(lockedStart)) {
          powerLineChains = moveLabelToChainFront(powerLineChains, lockedStart, lineNumber)
        } else if (chain[0]) {
          powerStartPoints[lineNumber] = chain[0]
        }
        return {
          ...prev,
          [activeScreen.id]: {
            ...current,
            manualModePower: true,
            manualOverrides: {
              ...current.manualOverrides,
              powerLines,
              powerLineChains,
              powerStartPoints,
            },
          },
        }
      })
    },
    [activeScreen.id, screens, pushPowerUndo],
  )

  const handleDataStartPoint = useCallback(
    (portNumber: number, label: string) => {
      const screen = screens.find((s) => s.id === activeScreen.id) ?? activeScreen
      const stripWidths = normalizeStripWidths(screen.stripWidths, screen.cabinetsWide)

      pushDataUndo()
      setRoutingByScreen((prev) => {
        const current = prev[activeScreen.id] ?? EMPTY_SCREEN_ROUTING
        const dataPorts = { ...current.manualOverrides.dataPorts, [label]: portNumber }
        const dataPortChains = moveLabelToChainFront(
          { ...(current.manualOverrides.dataPortChains ?? {}) },
          label,
          portNumber,
        )
        const dataStartPoints = { ...(current.manualOverrides.dataStartPoints ?? {}) }
        let dataPortControllers = {
          ...(current.manualOverrides.dataPortControllers ?? {}),
        }

        for (const [port, start] of Object.entries(dataStartPoints)) {
          if (start === label && Number(port) !== portNumber) {
            const first = dataPortChains[Number(port)]?.[0]
            if (first) dataStartPoints[Number(port)] = first
            else delete dataStartPoints[Number(port)]
          }
        }
        dataStartPoints[portNumber] = label

        if (screen.dualVx1000 && stripWidths.length > 1) {
          const cid = inferControllerFromLabel(label, screen)
          if (cid === 1 || cid === 2) dataPortControllers[portNumber] = cid
        }

        return {
          ...prev,
          [activeScreen.id]: {
            ...current,
            manualModeData: true,
            manualOverrides: {
              ...current.manualOverrides,
              dataPorts,
              dataPortChains,
              dataStartPoints,
              dataPortControllers,
            },
          },
        }
      })
    },
    [activeScreen, screens, pushDataUndo],
  )

  const removeCabinetFromData = useCallback(
    (label: string) => {
      setRoutingByScreen((prev) => {
        const current = prev[activeScreen.id] ?? EMPTY_SCREEN_ROUTING
        const dataPorts = { ...current.manualOverrides.dataPorts }
        const oldPort = dataPorts[label]
        delete dataPorts[label]
        const dataPortChains = removeLabelFromChains(
          { ...(current.manualOverrides.dataPortChains ?? {}) },
          label,
        )
        const dataStartPoints = { ...(current.manualOverrides.dataStartPoints ?? {}) }
        // Сбрасываем START только если удалили сам стартовый кабинет
        for (const [port, start] of Object.entries(dataStartPoints)) {
          if (start === label) {
            const first = dataPortChains[Number(port)]?.[0]
            if (first) dataStartPoints[Number(port)] = first
            else delete dataStartPoints[Number(port)]
          }
        }
        if (oldPort != null && dataPortChains[oldPort] == null) {
          delete dataStartPoints[oldPort]
        }
        return {
          ...prev,
          [activeScreen.id]: {
            ...current,
            manualOverrides: {
              ...current.manualOverrides,
              dataPorts,
              dataPortChains,
              dataStartPoints,
            },
          },
        }
      })
    },
    [activeScreen.id],
  )

  const removeCabinetFromPower = useCallback(
    (label: string) => {
      setRoutingByScreen((prev) => {
        const current = prev[activeScreen.id] ?? EMPTY_SCREEN_ROUTING
        const powerLines = { ...current.manualOverrides.powerLines }
        const oldLine = powerLines[label]
        delete powerLines[label]
        const powerLineChains = removeLabelFromChains(
          { ...(current.manualOverrides.powerLineChains ?? {}) },
          label,
        )
        const powerStartPoints = { ...(current.manualOverrides.powerStartPoints ?? {}) }
        // Сбрасываем START только если удалили сам стартовый кабинет
        for (const [line, start] of Object.entries(powerStartPoints)) {
          if (start === label) {
            const first = powerLineChains[Number(line)]?.[0]
            if (first) powerStartPoints[Number(line)] = first
            else delete powerStartPoints[Number(line)]
          }
        }
        if (oldLine != null && powerLineChains[oldLine] == null) {
          delete powerStartPoints[oldLine]
        }
        return {
          ...prev,
          [activeScreen.id]: {
            ...current,
            manualOverrides: {
              ...current.manualOverrides,
              powerLines,
              powerLineChains,
              powerStartPoints,
            },
          },
        }
      })
    },
    [activeScreen.id],
  )

  const handleUndoDataLast = useCallback(() => {
    const stack = dataPaintUndo[activeScreen.id] ?? []
    if (stack.length === 0) return
    const snapshot = stack[stack.length - 1]!
    setDataPaintUndo((u) => ({
      ...u,
      [activeScreen.id]: (u[activeScreen.id] ?? []).slice(0, -1),
    }))
    setRoutingByScreen((prev) => {
      const current = prev[activeScreen.id] ?? EMPTY_SCREEN_ROUTING
      return {
        ...prev,
        [activeScreen.id]: {
          ...current,
          manualModeData: true,
          manualOverrides: {
            ...current.manualOverrides,
            ...snapshot,
          },
        },
      }
    })
  }, [activeScreen.id, dataPaintUndo])

  const handleUndoPowerLast = useCallback(() => {
    const stack = powerPaintUndo[activeScreen.id] ?? []
    if (stack.length === 0) return
    const snapshot = stack[stack.length - 1]!
    setPowerPaintUndo((u) => ({
      ...u,
      [activeScreen.id]: (u[activeScreen.id] ?? []).slice(0, -1),
    }))
    setRoutingByScreen((prev) => {
      const current = prev[activeScreen.id] ?? EMPTY_SCREEN_ROUTING
      return {
        ...prev,
        [activeScreen.id]: {
          ...current,
          manualModePower: true,
          manualOverrides: {
            ...current.manualOverrides,
            ...snapshot,
          },
        },
      }
    })
  }, [activeScreen.id, powerPaintUndo])

  /** Клик по последнему кабинету активной линии — снять заполнение */
  const handleUndoDataCabinet = useCallback(
    (label: string) => {
      pushDataUndo()
      removeCabinetFromData(label)
    },
    [pushDataUndo, removeCabinetFromData],
  )

  const handleUndoPowerCabinet = useCallback(
    (label: string) => {
      pushPowerUndo()
      removeCabinetFromPower(label)
    },
    [pushPowerUndo, removeCabinetFromPower],
  )

  const handleClearDataManual = useCallback(() => {
    pushDataUndo()
    setRoutingByScreen((prev) => {
      const current = prev[activeScreen.id] ?? EMPTY_SCREEN_ROUTING
      return {
        ...prev,
        [activeScreen.id]: {
          ...current,
          manualModeData: true,
          manualOverrides: {
            ...current.manualOverrides,
            dataPorts: {},
            dataStartPoints: {},
            dataPortChains: {},
            dataPortControllers: {},
            dataPortColors: {},
          },
        },
      }
    })
  }, [activeScreen.id, pushDataUndo])

  const handleClearPowerManual = useCallback(() => {
    pushPowerUndo()
    setRoutingByScreen((prev) => {
      const current = prev[activeScreen.id] ?? EMPTY_SCREEN_ROUTING
      return {
        ...prev,
        [activeScreen.id]: {
          ...current,
          manualModePower: true,
          manualOverrides: {
            ...current.manualOverrides,
            powerLines: {},
            powerStartPoints: {},
            powerLineChains: {},
            powerLineColors: {},
          },
        },
      }
    })
  }, [activeScreen.id, pushPowerUndo])

  /** Перевернуть активную data-линию: первый кабинет становится последним */
  const handleReverseActiveDataLine = useCallback(
    (portNumber: number) => {
      if ((activeRouting.manualOverrides.dataPortChains?.[portNumber]?.length ?? 0) < 2) {
        return
      }
      pushDataUndo()
      setRoutingByScreen((prev) => {
        const current = prev[activeScreen.id] ?? EMPTY_SCREEN_ROUTING
        const dataPortChains = reverseChain(
          { ...(current.manualOverrides.dataPortChains ?? {}) },
          portNumber,
        )
        const chain = dataPortChains[portNumber]
        if (!chain || chain.length === 0) return prev
        const dataStartPoints = {
          ...(current.manualOverrides.dataStartPoints ?? {}),
          [portNumber]: chain[0],
        }
        return {
          ...prev,
          [activeScreen.id]: {
            ...current,
            manualModeData: true,
            manualOverrides: {
              ...current.manualOverrides,
              dataPortChains,
              dataStartPoints,
            },
          },
        }
      })
    },
    [activeRouting, activeScreen.id, pushDataUndo],
  )

  /** Перевернуть активную power-линию: первый кабинет становится последним */
  const handleReverseActivePowerLine = useCallback(
    (lineNumber: number) => {
      if ((activeRouting.manualOverrides.powerLineChains?.[lineNumber]?.length ?? 0) < 2) {
        return
      }
      pushPowerUndo()
      setRoutingByScreen((prev) => {
        const current = prev[activeScreen.id] ?? EMPTY_SCREEN_ROUTING
        const powerLineChains = reverseChain(
          { ...(current.manualOverrides.powerLineChains ?? {}) },
          lineNumber,
        )
        const chain = powerLineChains[lineNumber]
        if (!chain || chain.length === 0) return prev
        const powerStartPoints = {
          ...(current.manualOverrides.powerStartPoints ?? {}),
          [lineNumber]: chain[0],
        }
        return {
          ...prev,
          [activeScreen.id]: {
            ...current,
            manualModePower: true,
            manualOverrides: {
              ...current.manualOverrides,
              powerLineChains,
              powerStartPoints,
            },
          },
        }
      })
    },
    [activeRouting, activeScreen.id, pushPowerUndo],
  )

  /** Очистить активную data-линию: снять все кабинеты и сбросить цепочку */
  const handleClearActiveDataLine = useCallback(
    (portNumber: number) => {
      if ((activeRouting.manualOverrides.dataPortChains?.[portNumber]?.length ?? 0) === 0) {
        return
      }
      pushDataUndo()
      setRoutingByScreen((prev) => {
        const current = prev[activeScreen.id] ?? EMPTY_SCREEN_ROUTING
        const { chains: dataPortChains, labels } = clearChain(
          { ...(current.manualOverrides.dataPortChains ?? {}) },
          portNumber,
        )
        if (labels.length === 0) return prev
        const dataPorts = { ...current.manualOverrides.dataPorts }
        for (const label of labels) {
          delete dataPorts[label]
        }
        const dataStartPoints = { ...(current.manualOverrides.dataStartPoints ?? {}) }
        delete dataStartPoints[portNumber]
        return {
          ...prev,
          [activeScreen.id]: {
            ...current,
            manualModeData: true,
            manualOverrides: {
              ...current.manualOverrides,
              dataPorts,
              dataPortChains,
              dataStartPoints,
            },
          },
        }
      })
    },
    [activeRouting, activeScreen.id, pushDataUndo],
  )

  /** Очистить активную power-линию: снять все кабинеты и сбросить цепочку */
  const handleClearActivePowerLine = useCallback(
    (lineNumber: number) => {
      if ((activeRouting.manualOverrides.powerLineChains?.[lineNumber]?.length ?? 0) === 0) {
        return
      }
      pushPowerUndo()
      setRoutingByScreen((prev) => {
        const current = prev[activeScreen.id] ?? EMPTY_SCREEN_ROUTING
        const { chains: powerLineChains, labels } = clearChain(
          { ...(current.manualOverrides.powerLineChains ?? {}) },
          lineNumber,
        )
        if (labels.length === 0) return prev
        const powerLines = { ...current.manualOverrides.powerLines }
        for (const label of labels) {
          delete powerLines[label]
        }
        const powerStartPoints = { ...(current.manualOverrides.powerStartPoints ?? {}) }
        delete powerStartPoints[lineNumber]
        return {
          ...prev,
          [activeScreen.id]: {
            ...current,
            manualModePower: true,
            manualOverrides: {
              ...current.manualOverrides,
              powerLines,
              powerLineChains,
              powerStartPoints,
            },
          },
        }
      })
    },
    [activeRouting, activeScreen.id, pushPowerUndo],
  )

  /** Перенумеровать активную data-линию: move или swap с целевой */
  const handleRenumberActiveDataLine = useCallback(
    (from: number, to: number) => {
      if (from === to || !(activeRouting.manualOverrides.dataPortChains?.[from]?.length)) {
        return
      }
      pushDataUndo()
      let swapped = false
      setRoutingByScreen((prev) => {
        const current = prev[activeScreen.id] ?? EMPTY_SCREEN_ROUTING
        const chains = { ...(current.manualOverrides.dataPortChains ?? {}) }
        swapped = (chains[from] ?? []).length > 0 && (chains[to] ?? []).length > 0
        const result = renumberLine(
          chains,
          current.manualOverrides.dataStartPoints ?? {},
          current.manualOverrides.dataPorts ?? {},
          from,
          to,
        )
        if (!result) return prev
        return {
          ...prev,
          [activeScreen.id]: {
            ...current,
            manualModeData: true,
            manualOverrides: {
              ...current.manualOverrides,
              dataPortChains: result.chains,
              dataStartPoints: result.startPoints,
              dataPorts: result.assignments,
              dataPortControllers: remapDataPortControllers(
                current.manualOverrides.dataPortControllers,
                from,
                to,
                swapped,
              ),
              dataPortColors: remapLineColorOverrides(
                current.manualOverrides.dataPortColors,
                from,
                to,
                swapped,
              ),
            },
          },
        }
      })
    },
    [activeRouting, activeScreen.id, pushDataUndo],
  )

  /** Перенумеровать активную power-линию: move или swap с целевой */
  const handleRenumberActivePowerLine = useCallback(
    (from: number, to: number) => {
      if (from === to || !(activeRouting.manualOverrides.powerLineChains?.[from]?.length)) {
        return
      }
      pushPowerUndo()
      let swapped = false
      setRoutingByScreen((prev) => {
        const current = prev[activeScreen.id] ?? EMPTY_SCREEN_ROUTING
        const chains = { ...(current.manualOverrides.powerLineChains ?? {}) }
        swapped = (chains[from] ?? []).length > 0 && (chains[to] ?? []).length > 0
        const result = renumberLine(
          chains,
          current.manualOverrides.powerStartPoints ?? {},
          current.manualOverrides.powerLines ?? {},
          from,
          to,
        )
        if (!result) return prev
        return {
          ...prev,
          [activeScreen.id]: {
            ...current,
            manualModePower: true,
            manualOverrides: {
              ...current.manualOverrides,
              powerLineChains: result.chains,
              powerStartPoints: result.startPoints,
              powerLines: result.assignments,
              powerLineColors: remapLineColorOverrides(
                current.manualOverrides.powerLineColors,
                from,
                to,
                swapped,
              ),
            },
          },
        }
      })
    },
    [activeRouting, activeScreen.id, pushPowerUndo],
  )

  const handlePowerStartPoint = useCallback(
    (lineNumber: number, label: string) => {
      pushPowerUndo()
      setRoutingByScreen((prev) => {
        const current = prev[activeScreen.id] ?? EMPTY_SCREEN_ROUTING
        const powerLines = {
          ...current.manualOverrides.powerLines,
          [label]: lineNumber,
        }
        const powerLineChains = moveLabelToChainFront(
          { ...(current.manualOverrides.powerLineChains ?? {}) },
          label,
          lineNumber,
        )
        const powerStartPoints = { ...(current.manualOverrides.powerStartPoints ?? {}) }
        for (const [line, start] of Object.entries(powerStartPoints)) {
          if (start === label && Number(line) !== lineNumber) {
            const first = powerLineChains[Number(line)]?.[0]
            if (first) powerStartPoints[Number(line)] = first
            else delete powerStartPoints[Number(line)]
          }
        }
        powerStartPoints[lineNumber] = label
        return {
          ...prev,
          [activeScreen.id]: {
            ...current,
            manualModePower: true,
            manualOverrides: {
              ...current.manualOverrides,
              powerLines,
              powerLineChains,
              powerStartPoints,
            },
          },
        }
      })
    },
    [activeScreen.id, pushPowerUndo],
  )

  const handleToggleEmpty = useCallback(
    (label: string) => {
      const nextEmpty = activeScreen.emptyCabinets.includes(label)
        ? activeScreen.emptyCabinets.filter((l) => l !== label)
        : [...activeScreen.emptyCabinets, label]
      updateActiveScreen({ ...activeScreen, emptyCabinets: nextEmpty })
      if (anyManual) {
        setRoutingByScreen((prev) => {
          const current = prev[activeScreen.id] ?? EMPTY_SCREEN_ROUTING
          const dataPorts = { ...current.manualOverrides.dataPorts }
          const powerLines = { ...current.manualOverrides.powerLines }
          const dataStartPoints = { ...current.manualOverrides.dataStartPoints }
          const powerStartPoints = { ...current.manualOverrides.powerStartPoints }
          delete dataPorts[label]
          delete powerLines[label]
          const dataPortChains = removeLabelFromChains(
            { ...(current.manualOverrides.dataPortChains ?? {}) },
            label,
          )
          const powerLineChains = removeLabelFromChains(
            { ...(current.manualOverrides.powerLineChains ?? {}) },
            label,
          )
          for (const [port, start] of Object.entries(dataStartPoints)) {
            if (start === label) {
              const first = dataPortChains[Number(port)]?.[0]
              if (first) dataStartPoints[Number(port)] = first
              else delete dataStartPoints[Number(port)]
            }
          }
          for (const [line, start] of Object.entries(powerStartPoints)) {
            if (start === label) {
              const first = powerLineChains[Number(line)]?.[0]
              if (first) powerStartPoints[Number(line)] = first
              else delete powerStartPoints[Number(line)]
            }
          }
          return {
            ...prev,
            [activeScreen.id]: {
              ...current,
              manualOverrides: {
                dataPorts,
                powerLines,
                dataStartPoints,
                powerStartPoints,
                dataPortChains,
                powerLineChains,
              },
            },
          }
        })
      }
    },
    [activeScreen, updateActiveScreen, anyManual],
  )

  const handleAddScreen = useCallback(() => {
    const newScreen = createScreen({ name: `Screen ${screens.length + 1}` })
    setScreens((prev) => [...prev, newScreen])
    setRoutingByScreen((prev) => ({ ...prev, [newScreen.id]: { ...EMPTY_SCREEN_ROUTING } }))
    setActiveScreenId(newScreen.id)
  }, [screens.length])

  const handleRemoveScreen = useCallback(
    (id: string) => {
      if (screens.length <= 1) return
      setScreens((prev) => {
        const next = prev.filter((s) => s.id !== id)
        if (activeScreenId === id) setActiveScreenId(next[0].id)
        return next
      })
      setRoutingByScreen((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    },
    [screens.length, activeScreenId],
  )

  const handleRenameScreen = useCallback((id: string, name: string) => {
    setScreens((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)))
  }, [])

  const config = activeScreen
  const cabinetCount = config.cabinetsWide * config.cabinetsHigh
  const stripPitches = useMemo(
    () => resolveAllStripPitches(config, screens),
    [config, screens],
  )
  const stripCabinetSizes = useMemo(
    () =>
      stripPitches.map((p) => ({
        w: p.cabinetWidthMm,
        h: p.cabinetHeightMm,
      })),
    [stripPitches],
  )
  const { pixelsWide: cabPixelsWide, pixelsHigh: cabPixelsHigh } =
    calcPixelsPerCabinet(config)
  const normalizedStrips = normalizeStripWidths(config.stripWidths, config.cabinetsWide)
  const screenPixelsWide = normalizedStrips.reduce(
    (sum, w, i) => sum + w * (stripPitches[i]?.pixelsWide ?? cabPixelsWide),
    0,
  )
  const screenPixelsHigh = Math.max(
    ...stripPitches.map((p) => config.cabinetsHigh * p.pixelsHigh),
    config.cabinetsHigh * cabPixelsHigh,
  )
  const maxPixelsPerPort = getMaxPixelsPerDataPort(config.refreshRate)
  const maxCabinetsPerPort =
    result != null
      ? getMaxCabinetsPerDataPort(config.refreshRate, result.summary.pixelsPerCabinet)
      : 0
  const powerLineLimitHint = getPowerLineLimitHint(config)

  const packingItems =
    showCombinedPacking && screens.length > 1
      ? combinedPackingList
      : result?.packingList ?? []
  const handleSelectScreen = useCallback((id: string) => {
    setActiveScreenId(id)
    setSidebarOpen(false)
  }, [])

  return (
    <div className="flex h-screen flex-col">
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {sidebarOpen && (
          <button
            type="button"
            aria-label="Закрыть меню"
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <Sidebar
          screens={screens}
          activeScreenId={activeScreenId}
          config={activeScreen}
          onChange={updateActiveScreen}
          onSelectScreen={handleSelectScreen}
          onAddScreen={handleAddScreen}
          onRemoveScreen={handleRemoveScreen}
          onRenameScreen={handleRenameScreen}
          emptyPaintMode={emptyPaintMode}
          onEmptyPaintModeChange={setEmptyPaintMode}
          gridLayout={gridLayout}
          onGridLayoutChange={setGridLayout}
          showCombinedPacking={showCombinedPacking}
          onShowCombinedPackingChange={setShowCombinedPacking}
          globalTotals={globalTotals}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="no-print flex shrink-0 flex-col gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6">
            <div className="flex min-w-0 items-start gap-3">
              <button
                type="button"
                aria-label="Открыть настройки"
                aria-expanded={sidebarOpen}
                onClick={() => setSidebarOpen(true)}
                className="touch-manipulation shrink-0 rounded-lg border border-slate-200 p-2.5 text-slate-700 transition hover:bg-slate-50 md:hidden"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              </button>
              <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold leading-snug text-slate-900 sm:text-base">
                {activeScreen.name} — {config.wallWidthM}×{config.wallHeightM} m (
                {config.cabinetsWide}×{config.cabinetsHigh} cabs) · {config.controllerModel}
              </h2>
              {showInitialSpinner ? (
                <p className="mt-2 text-xs text-slate-400">Расчёт маршрутизации…</p>
              ) : (
                result && (
                  <div className="mt-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold tabular-nums text-slate-800 sm:text-sm">
                    <span className="text-slate-900">
                      {screenPixelsWide.toLocaleString()}×{screenPixelsHigh.toLocaleString()} px
                    </span>
                    {' · '}
                    {result.summary.dataPorts} линий тикшорет ·{' '}
                    {result.summary.powerLines} линий электричества
                    {result.summary.emptyCabinets > 0 && (
                      <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 sm:text-xs">
                        {result.summary.emptyCabinets} empty
                      </span>
                    )}
                  </div>
                )
              )}
              <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                {manualModeData && (
                  <span className="mr-2 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">
                    Manual Data
                  </span>
                )}
                {manualModePower && (
                  <span className="mr-2 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">
                    Manual Power
                  </span>
                )}
                {screens.length > 1 && (
                  <span className="text-slate-400">
                    {globalTotals.totalCabinets} cabinets all screens
                  </span>
                )}
              </p>
              {!showInitialSpinner && screenSummaries.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {screenSummaries.map((s) => (
                    <span
                      key={s.id}
                      className={`rounded-md border px-2.5 py-1 text-[10px] font-semibold tabular-nums sm:text-xs ${
                        s.id === activeScreenId
                          ? 'border-blue-200 bg-blue-50 text-blue-950'
                          : 'border-slate-200 bg-white text-slate-700'
                      }`}
                    >
                      {s.name}: {s.resolution} · {s.dataLines} data · {s.powerLines} power
                    </span>
                  ))}
                </div>
              )}
              </div>
            </div>
            <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
              {equipmentList && (
                <button
                  type="button"
                  onClick={() => void downloadEquipmentListXlsx(equipmentList)}
                  className="touch-manipulation rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-800 shadow-sm transition hover:bg-emerald-100"
                  title="Сохранить רשימת ציוד в Excel"
                >
                  שמור xlsx
                </button>
              )}
              <button
                type="button"
                onClick={() => window.print()}
                className="touch-manipulation rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
              >
                Print Scheme
              </button>
            </div>
          </header>

          {!showInitialSpinner &&
            result &&
            needsHighPixelController(
              result.summary.totalPixels,
              config.controllerModel,
            ) && (
              <div
                className="no-print shrink-0 border-b border-red-500 bg-red-100 px-4 py-2.5 text-sm font-medium text-red-800 sm:px-6"
                role="alert"
              >
                <strong className="font-bold text-red-900">
                  {result.summary.totalPixels.toLocaleString()} px
                </strong>
                {' > '}
                {(HIGH_PIXEL_SCREEN_THRESHOLD / 1_000_000).toFixed(1)}M — выберите
                контроллер <strong className="text-red-950">VX2000</strong>,{' '}
                <strong className="text-red-950">H2</strong> или{' '}
                <strong className="text-red-950">MCTRL4K</strong>
                {' / '}
                Select <strong className="text-red-950">VX2000</strong>,{' '}
                <strong className="text-red-950">H2</strong> or{' '}
                <strong className="text-red-950">MCTRL4K</strong>
                {' / '}
                בחר <strong className="text-red-950">VX2000</strong>,{' '}
                <strong className="text-red-950">H2</strong> או{' '}
                <strong className="text-red-950">MCTRL4K</strong>
              </div>
            )}

          <div className="print-only border-b border-slate-300 px-6 py-4">
            <h1 className="text-lg font-bold">
              LED Cable Mapping — {activeScreen.name} {config.wallWidthM}×{config.wallHeightM} m (
              {config.cabinetsWide}×{config.cabinetsHigh})
            </h1>
            <p className="text-sm text-slate-600">
              {config.controllerModel} · Trunk {config.trunkLengthM}m ·{' '}
              {new Date().toLocaleDateString()}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
            {result && result.warnings.length > 0 && (              <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
                <p className="text-xs font-semibold text-amber-900">
                  Routing warnings / Предупреждения
                </p>
                <ul className="mt-1 space-y-0.5">
                  {result.warnings.map((w, i) => (
                    <li key={`${w.type}-${w.id}-${i}`} className="text-xs text-amber-800">
                      {w.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {showInitialSpinner ? (
              <RoutingSpinner
                cabinetCount={cabinetCount}
                label={
                  isRouting
                    ? 'Подготовка интерфейса…'
                    : 'Расчёт маршрутизации…'
                }
              />
            ) : (
              <div className={showRecalcOverlay ? 'relative' : undefined}>
                {showRecalcOverlay && (
                  <div className="absolute inset-0 z-10 flex items-start justify-center bg-white/70 pt-16 backdrop-blur-[1px]">
                    <RoutingSpinner
                      cabinetCount={cabinetCount}
                      label="Обновление сетки…"
                    />
                  </div>
                )}
              <>
            <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <SummaryCard label="Cabinets" value={result!.summary.totalCabinets} />              <SummaryCard
                label="Pixels / Cabinet"
                value={result!.summary.pixelsPerCabinet.toLocaleString()}
              />
              <SummaryCard
                label="Data Ports"
                value={result!.summary.dataPorts}
                sub={`max ${maxCabinetsPerPort} cab / ${(maxPixelsPerPort / 1000).toFixed(0)}k px @ ${config.refreshRate}Hz`}
              />
              <SummaryCard label="Backup Ports" value={result!.summary.backupPorts} />
              <SummaryCard
                label="Power Lines"
                value={result!.summary.powerLines}
                sub={`${powerLineLimitHint} · ${result!.summary.cabinetsPerPowerLine} auto target`}
              />
              <SummaryCard label="Cables" value={result!.cableSchedule.length} sub="in schedule" />
            </div>

            <div className="space-y-6">
              <div
                className={`grid gap-6 ${
                  gridLayout === 'side-by-side' ? 'xl:grid-cols-2' : 'grid-cols-1'
                }`}
              >
                <GridVisualization
                  result={result!}
                  wide={config.cabinetsWide}
                  high={config.cabinetsHigh}
                  mode="data"
                  screenName={activeScreen.name}
                  wallWidthM={config.wallWidthM}
                  wallHeightM={config.wallHeightM}
                  controllerModel={config.controllerModel}
                  refreshRate={config.refreshRate}
                  chainStartEdge={config.chainStartEdge}
                  pitchPreset={config.pitchPreset}
                  stripWidths={config.stripWidths}
                  stripHeights={config.stripHeights}
                  dualVx1000={config.dualVx1000}
                  stripControllerIds={config.stripControllerIds}
                  dataPortControllers={manualOverrides.dataPortControllers}
                  onSetDataPortController={handleSetDataPortController}
                  lineColorOverrides={manualOverrides.dataPortColors}
                  onSetLineColor={handleSetDataLineColor}
                  screenPixelsWide={screenPixelsWide}
                  screenPixelsHigh={screenPixelsHigh}
                  cabinetWidthMm={config.cabinetWidthMm}
                  cabinetHeightMm={config.cabinetHeightMm}
                  stripCabinetSizes={stripCabinetSizes}
                  signalBackup={config.signalBackup}
                  backupPortMode={config.backupPortMode}
                  mainPortDisplayNumbers={config.mainPortDisplayNumbers}
                  backupPortDisplayNumbers={config.backupPortDisplayNumbers}
                  onBackupNumberingChange={(patch) =>
                    updateActiveScreen({ ...activeScreen, ...patch })
                  }
                  manualMode={manualModeData}
                  onManualModeChange={handleManualModeDataChange}
                  emptyCabinets={activeScreen.emptyCabinets}
                  emptyPaintMode={emptyPaintMode}
                  onToggleEmpty={handleToggleEmpty}
                  manualAssignments={manualOverrides.dataPorts}
                  chainOrder={
                    manualOverrides.dataPortChains ?? EMPTY_MANUAL_OVERRIDES.dataPortChains
                  }
                  startPoints={
                    manualOverrides.dataStartPoints ?? EMPTY_MANUAL_OVERRIDES.dataStartPoints
                  }
                  onAssign={handleDataAssignment}
                  onSetStartPoint={handleDataStartPoint}
                  onClearManual={handleClearDataManual}
                  onUndoLast={handleUndoDataLast}
                  onUndoCabinet={handleUndoDataCabinet}
                  onReverseActiveLine={handleReverseActiveDataLine}
                  onClearActiveLine={handleClearActiveDataLine}
                  onRenumberActiveLine={handleRenumberActiveDataLine}
                  canUndo={(dataPaintUndo[activeScreen.id] ?? []).length > 0}
                  maxAssignable={Math.max(
                    result!.summary.dataPorts,
                    autoResult?.summary.dataPorts ?? result!.summary.dataPorts,
                    1,
                  )}
                />
                <GridVisualization
                  result={result!}
                  wide={config.cabinetsWide}
                  high={config.cabinetsHigh}
                  mode="power"
                  screenName={activeScreen.name}
                  wallWidthM={config.wallWidthM}
                  wallHeightM={config.wallHeightM}
                  controllerModel={config.controllerModel}
                  refreshRate={config.refreshRate}
                  chainStartEdge={config.chainStartEdge}
                  pitchPreset={config.pitchPreset}
                  powerFeedMode={config.powerFeedMode}
                  stripWidths={config.stripWidths}
                  stripHeights={config.stripHeights}
                  dualVx1000={config.dualVx1000}
                  screenPixelsWide={screenPixelsWide}
                  screenPixelsHigh={screenPixelsHigh}
                  cabinetWidthMm={config.cabinetWidthMm}
                  cabinetHeightMm={config.cabinetHeightMm}
                  stripCabinetSizes={stripCabinetSizes}
                  manualMode={manualModePower}
                  onManualModeChange={handleManualModePowerChange}
                  emptyCabinets={activeScreen.emptyCabinets}
                  emptyPaintMode={emptyPaintMode}
                  onToggleEmpty={handleToggleEmpty}
                  manualAssignments={manualOverrides.powerLines}
                  chainOrder={
                    manualOverrides.powerLineChains ?? EMPTY_MANUAL_OVERRIDES.powerLineChains
                  }
                  startPoints={
                    manualOverrides.powerStartPoints ?? EMPTY_MANUAL_OVERRIDES.powerStartPoints
                  }
                  onAssign={handlePowerAssignment}
                  onSetStartPoint={handlePowerStartPoint}
                  onClearManual={handleClearPowerManual}
                  onUndoLast={handleUndoPowerLast}
                  onUndoCabinet={handleUndoPowerCabinet}
                  onReverseActiveLine={handleReverseActivePowerLine}
                  onClearActiveLine={handleClearActivePowerLine}
                  onRenumberActiveLine={handleRenumberActivePowerLine}
                  canUndo={(powerPaintUndo[activeScreen.id] ?? []).length > 0}
                  lineColorOverrides={manualOverrides.powerLineColors}
                  onSetLineColor={handleSetPowerLineColor}
                  maxAssignable={Math.max(
                    result!.summary.powerLines,
                    autoResult?.summary.powerLines ?? result!.summary.powerLines,
                    1,
                  )}
                />
              </div>

              <RoutingSchema lines={result!.routingSchema} />

              <div className="print-break">
                <CableScheduleTable entries={result!.cableSchedule} />
              </div>
              <PackingListView
                items={packingItems}
                title={
                  showCombinedPacking && screens.length > 1
                    ? 'Combined Packing List (all screens)'
                    : `Packing List — ${activeScreen.name}`
                }
              />

              {showCombinedPacking && screens.length > 1 && (
                <CableScheduleTable
                  entries={combinedCableSchedule}
                  title="Combined Cable Schedule"
                />
              )}

              {equipmentList && (
                <EquipmentListTable
                  state={equipmentList}
                  onChange={setEquipmentList}
                  onRefreshFromRouting={handleRefreshEquipmentList}
                />
              )}
            </div>
              </>
              </div>
            )}
          </div>        </main>
      </div>
    </div>
  )
}
