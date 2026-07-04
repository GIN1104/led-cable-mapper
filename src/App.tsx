import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GridLayout, ScreenConfig, ScreenRoutingState } from './types'
import {
  createScreen,
  DEFAULT_PROJECT,
  EMPTY_MANUAL_OVERRIDES,
  EMPTY_SCREEN_ROUTING,
} from './types'
import { computeRouting, buildAutoManualOverrides } from './lib/routingEngine'
import { buildCombinedPackingList } from './lib/packingList'
import { syncCabinetGridFromMeters } from './lib/cabinetGrid'
import {
  getMaxCabinetsPerDataPort,
  getPowerLineLimitHint,
  getMaxPixelsPerDataPort,
} from './lib/constants'
import Sidebar from './components/Sidebar'
import GridVisualization from './components/GridVisualization'
import RoutingSchema from './components/RoutingSchema'
import CableScheduleTable from './components/CableScheduleTable'
import PackingListView from './components/PackingListView'

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
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p className="mt-0.5 text-xl font-bold text-slate-900">{value}</p>
      {sub && <p className="text-[10px] text-slate-500">{sub}</p>}
    </div>
  )
}

function pruneEmptyFromGrid(emptyCabinets: string[], wide: number, high: number): string[] {
  const maxRow = high - 1
  const maxCol = wide - 1
  return emptyCabinets.filter((label) => {
    const match = /^([A-Z]+)(\d+)$/.exec(label)
    if (!match) return false
    const col = parseInt(match[2], 10) - 1
    let row = 0
    for (const ch of match[1]) {
      row = row * 26 + (ch.charCodeAt(0) - 64)
    }
    row -= 1
    return row >= 0 && row <= maxRow && col >= 0 && col <= maxCol
  })
}

export default function App() {
  const [screens, setScreens] = useState<ScreenConfig[]>(DEFAULT_PROJECT.screens)
  const [activeScreenId, setActiveScreenId] = useState(DEFAULT_PROJECT.activeScreenId)
  const [routingByScreen, setRoutingByScreen] = useState<Record<string, ScreenRoutingState>>({
    [DEFAULT_PROJECT.activeScreenId]: { ...EMPTY_SCREEN_ROUTING },
  })
  const [emptyPaintMode, setEmptyPaintMode] = useState(false)
  const [gridLayout, setGridLayout] = useState<GridLayout>('side-by-side')
  const [showCombinedPacking, setShowCombinedPacking] = useState(false)

  const activeScreen = useMemo(
    () => screens.find((s) => s.id === activeScreenId) ?? screens[0],
    [screens, activeScreenId],
  )

  const activeRouting = routingByScreen[activeScreen.id] ?? EMPTY_SCREEN_ROUTING
  const { manualMode, manualOverrides } = activeRouting

  const prevGridSize = useRef(
    `${activeScreen.id}:${activeScreen.cabinetsWide}x${activeScreen.cabinetsHigh}`,
  )

  const autoResult = useMemo(() => computeRouting(activeScreen), [activeScreen])

  const result = useMemo(
    () =>
      computeRouting(activeScreen, {
        manualMode,
        manualOverrides: manualMode ? manualOverrides : undefined,
      }),
    [activeScreen, manualMode, manualOverrides],
  )

  const allScreenResults = useMemo(
    () =>
      screens.map((screen) => {
        const routing = routingByScreen[screen.id] ?? EMPTY_SCREEN_ROUTING
        return {
          screen,
          result: computeRouting(screen, {
            manualMode: routing.manualMode,
            manualOverrides: routing.manualMode ? routing.manualOverrides : undefined,
          }),
        }
      }),
    [screens, routingByScreen],
  )

  const globalTotals = useMemo(() => {
    let totalCabinets = 0
    let totalPixels = 0
    let totalEmpty = 0
    for (const { result: r } of allScreenResults) {
      totalCabinets += r.summary.totalCabinets
      totalPixels += r.summary.totalPixels
      totalEmpty += r.summary.emptyCabinets
    }
    return { totalCabinets, totalPixels, totalEmpty, screenCount: screens.length }
  }, [allScreenResults, screens.length])

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

  useEffect(() => {
    const gridKey = `${activeScreen.id}:${activeScreen.cabinetsWide}x${activeScreen.cabinetsHigh}`
    if (gridKey !== prevGridSize.current) {
      prevGridSize.current = gridKey
      setRoutingByScreen((prev) => {
        const current = prev[activeScreen.id] ?? EMPTY_SCREEN_ROUTING
        return {
          ...prev,
          [activeScreen.id]: {
            ...current,
            manualOverrides: current.manualMode
              ? buildAutoManualOverrides(activeScreen)
              : EMPTY_MANUAL_OVERRIDES,
          },
        }
      })
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
  }, [activeScreen])

  const updateActiveScreen = useCallback((next: ScreenConfig) => {
    setScreens((prev) => prev.map((s) => (s.id === next.id ? syncCabinetGridFromMeters(next) : s)))
  }, [])

  const setActiveRouting = useCallback(
    (patch: Partial<ScreenRoutingState>) => {
      setRoutingByScreen((prev) => ({
        ...prev,
        [activeScreen.id]: { ...(prev[activeScreen.id] ?? EMPTY_SCREEN_ROUTING), ...patch },
      }))
    },
    [activeScreen.id],
  )

  const handleManualModeChange = useCallback(
    (enabled: boolean) => {
      if (enabled) {
        setActiveRouting({
          manualMode: true,
          manualOverrides: buildAutoManualOverrides(activeScreen),
        })
      } else {
        setActiveRouting({ manualMode: false })
      }
    },
    [activeScreen, setActiveRouting],
  )

  const handleDataAssignment = useCallback(
    (labels: string[], portNumber: number) => {
      setRoutingByScreen((prev) => {
        const current = prev[activeScreen.id] ?? EMPTY_SCREEN_ROUTING
        const dataPorts = { ...current.manualOverrides.dataPorts }
        const dataStartPoints = { ...current.manualOverrides.dataStartPoints }
        for (const label of labels) {
          if (!activeScreen.emptyCabinets.includes(label)) {
            dataPorts[label] = portNumber
            if (!dataStartPoints[portNumber]) {
              dataStartPoints[portNumber] = label
            }
          }
        }
        return {
          ...prev,
          [activeScreen.id]: {
            ...current,
            manualMode: true,
            manualOverrides: {
              ...current.manualOverrides,
              dataPorts,
              dataStartPoints,
            },
          },
        }
      })
    },
    [activeScreen],
  )

  const handlePowerAssignment = useCallback(
    (labels: string[], lineNumber: number) => {
      setRoutingByScreen((prev) => {
        const current = prev[activeScreen.id] ?? EMPTY_SCREEN_ROUTING
        const powerLines = { ...current.manualOverrides.powerLines }
        const powerStartPoints = { ...current.manualOverrides.powerStartPoints }
        for (const label of labels) {
          if (!activeScreen.emptyCabinets.includes(label)) {
            powerLines[label] = lineNumber
            if (!powerStartPoints[lineNumber]) {
              powerStartPoints[lineNumber] = label
            }
          }
        }
        return {
          ...prev,
          [activeScreen.id]: {
            ...current,
            manualMode: true,
            manualOverrides: {
              ...current.manualOverrides,
              powerLines,
              powerStartPoints,
            },
          },
        }
      })
    },
    [activeScreen],
  )

  const handleDataStartPoint = useCallback(
    (portNumber: number, label: string) => {
      setRoutingByScreen((prev) => {
        const current = prev[activeScreen.id] ?? EMPTY_SCREEN_ROUTING
        return {
          ...prev,
          [activeScreen.id]: {
            ...current,
            manualOverrides: {
              ...current.manualOverrides,
              dataStartPoints: { ...current.manualOverrides.dataStartPoints, [portNumber]: label },
            },
          },
        }
      })
    },
    [activeScreen.id],
  )

  const handlePowerStartPoint = useCallback(
    (lineNumber: number, label: string) => {
      setRoutingByScreen((prev) => {
        const current = prev[activeScreen.id] ?? EMPTY_SCREEN_ROUTING
        const assignedLine = current.manualOverrides.powerLines[label]
        return {
          ...prev,
          [activeScreen.id]: {
            ...current,
            manualMode: true,
            manualOverrides: {
              ...current.manualOverrides,
              powerLines:
                assignedLine == null
                  ? { ...current.manualOverrides.powerLines, [label]: lineNumber }
                  : current.manualOverrides.powerLines,
              powerStartPoints: {
                ...current.manualOverrides.powerStartPoints,
                [lineNumber]: label,
              },
            },
          },
        }
      })
    },
    [activeScreen.id],
  )

  const handleToggleEmpty = useCallback(
    (label: string) => {
      const nextEmpty = activeScreen.emptyCabinets.includes(label)
        ? activeScreen.emptyCabinets.filter((l) => l !== label)
        : [...activeScreen.emptyCabinets, label]
      updateActiveScreen({ ...activeScreen, emptyCabinets: nextEmpty })
      if (manualMode) {
        setRoutingByScreen((prev) => {
          const current = prev[activeScreen.id] ?? EMPTY_SCREEN_ROUTING
          const dataPorts = { ...current.manualOverrides.dataPorts }
          const powerLines = { ...current.manualOverrides.powerLines }
          const dataStartPoints = { ...current.manualOverrides.dataStartPoints }
          const powerStartPoints = { ...current.manualOverrides.powerStartPoints }
          delete dataPorts[label]
          delete powerLines[label]
          for (const [port, start] of Object.entries(dataStartPoints)) {
            if (start === label) delete dataStartPoints[Number(port)]
          }
          for (const [line, start] of Object.entries(powerStartPoints)) {
            if (start === label) delete powerStartPoints[Number(line)]
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
              },
            },
          }
        })
      }
    },
    [activeScreen, updateActiveScreen, manualMode],
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
  const maxPixelsPerPort = getMaxPixelsPerDataPort(config.refreshRate)
  const maxCabinetsPerPort = getMaxCabinetsPerDataPort(
    config.refreshRate,
    result.summary.pixelsPerCabinet,
  )
  const powerLineLimitHint = getPowerLineLimitHint(config)

  const packingItems =
    showCombinedPacking && screens.length > 1 ? combinedPackingList : result.packingList

  return (
    <div className="flex h-screen flex-col">
      <div className="flex min-h-0 flex-1">
        <Sidebar
          screens={screens}
          activeScreenId={activeScreenId}
          config={activeScreen}
          onChange={updateActiveScreen}
          onSelectScreen={setActiveScreenId}
          onAddScreen={handleAddScreen}
          onRemoveScreen={handleRemoveScreen}
          onRenameScreen={handleRenameScreen}
          manualMode={manualMode}
          onManualModeChange={handleManualModeChange}
          emptyPaintMode={emptyPaintMode}
          onEmptyPaintModeChange={setEmptyPaintMode}
          gridLayout={gridLayout}
          onGridLayoutChange={setGridLayout}
          showCombinedPacking={showCombinedPacking}
          onShowCombinedPackingChange={setShowCombinedPacking}
          globalTotals={globalTotals}
        />

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="no-print flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {activeScreen.name} — {config.wallWidthM}×{config.wallHeightM} m (
                {config.cabinetsWide}×{config.cabinetsHigh} cabs) · {config.controllerModel}
              </h2>
              <p className="text-xs text-slate-500">
                {result.summary.totalPixels.toLocaleString()} px · {result.summary.dataPorts} data
                port{result.summary.dataPorts !== 1 ? 's' : ''} · {result.summary.powerLines} power
                line{result.summary.powerLines !== 1 ? 's' : ''}
                {result.summary.emptyCabinets > 0 && (
                  <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 font-medium text-slate-700">
                    {result.summary.emptyCabinets} empty
                  </span>
                )}
                {manualMode && (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">
                    Manual
                  </span>
                )}
                {screens.length > 1 && (
                  <span className="ml-2 text-slate-400">
                    · {globalTotals.totalCabinets} cabinets all screens
                  </span>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
            >
              Print Scheme
            </button>
          </header>

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

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {result.warnings.length > 0 && (
              <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
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

            <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <SummaryCard label="Cabinets" value={result.summary.totalCabinets} />
              <SummaryCard
                label="Pixels / Cabinet"
                value={result.summary.pixelsPerCabinet.toLocaleString()}
              />
              <SummaryCard
                label="Data Ports"
                value={result.summary.dataPorts}
                sub={`max ${maxCabinetsPerPort} cab / ${(maxPixelsPerPort / 1000).toFixed(0)}k px @ ${config.refreshRate}Hz`}
              />
              <SummaryCard label="Backup Ports" value={result.summary.backupPorts} />
              <SummaryCard
                label="Power Lines"
                value={result.summary.powerLines}
                sub={`${powerLineLimitHint} · ${result.summary.cabinetsPerPowerLine} auto target`}
              />
              <SummaryCard label="Cables" value={result.cableSchedule.length} sub="in schedule" />
            </div>

            <div className="space-y-6">
              <div
                className={`grid gap-6 ${
                  gridLayout === 'side-by-side' ? 'xl:grid-cols-2' : 'grid-cols-1'
                }`}
              >
                <GridVisualization
                  result={result}
                  wide={config.cabinetsWide}
                  high={config.cabinetsHigh}
                  mode="data"
                  chainStartEdge={config.chainStartEdge}
                  pitchPreset={config.pitchPreset}
                  manualMode={manualMode}
                  emptyCabinets={activeScreen.emptyCabinets}
                  emptyPaintMode={emptyPaintMode}
                  onToggleEmpty={handleToggleEmpty}
                  manualAssignments={manualOverrides.dataPorts}
                  startPoints={manualOverrides.dataStartPoints ?? {}}
                  onAssign={handleDataAssignment}
                  onSetStartPoint={handleDataStartPoint}
                  maxAssignable={Math.max(
                    result.summary.dataPorts,
                    autoResult.summary.dataPorts,
                    1,
                  )}
                />
                <GridVisualization
                  result={result}
                  wide={config.cabinetsWide}
                  high={config.cabinetsHigh}
                  mode="power"
                  chainStartEdge={config.chainStartEdge}
                  pitchPreset={config.pitchPreset}
                  manualMode={manualMode}
                  emptyCabinets={activeScreen.emptyCabinets}
                  emptyPaintMode={emptyPaintMode}
                  onToggleEmpty={handleToggleEmpty}
                  manualAssignments={manualOverrides.powerLines}
                  startPoints={manualOverrides.powerStartPoints ?? {}}
                  onAssign={handlePowerAssignment}
                  onSetStartPoint={handlePowerStartPoint}
                  maxAssignable={Math.max(
                    result.summary.powerLines,
                    autoResult.summary.powerLines,
                    1,
                  )}
                />
              </div>

              <RoutingSchema lines={result.routingSchema} />

              <div className="print-break">
                <CableScheduleTable entries={result.cableSchedule} />
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
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
