import { useEffect, useMemo, useRef, useState, startTransition, type ReactNode } from 'react'

import type {

  ScreenConfig,

  ControllerModel,

  TrunkLengthM,

  RefreshRate,

  GridLayout,

  ChainStartEdge,

  PowerFeedMode,

  PitchPresetId,

  CustomDensityInput,

} from '../types'

import { CONTROLLER_MODELS, createScreen } from '../types'

import { getPowerLineLimitHint } from '../lib/constants'

import {

  PITCH_PRESETS,

  CUSTOM_PRESET_LABEL,

  applyPitchPreset,

  getPitchPreset,

} from '../lib/pitchPresets'

import {
  calcCabinetsFromMeters,
  calcPixelsPerCabinet,
  clampWallDimensionM,
  defaultStripControllerIds,
  equalStripWidths,
  isMeterDraftEditable,
  MIN_WALL_DIMENSION_M,
  normalizeStripControllerIds,
  normalizeStripHeights,
  normalizeStripWidths,
  parseMeterDraftForCommit,
  previewMeterFromDraft,
  applyStripHeightAt,
  setStripWidthAt,
  syncCabinetGridFromMeters,
} from '../lib/cabinetGrid'
import {
  inheritStripPitch,
  normalizeStripPitchConfigs,
  resolveStripPitch,
  stripPitchFromPreset,
  stripPitchFromScreen,
  buildStripMixFromScreens,
} from '../lib/stripPitch'
import {
  applyStripRowMixBands,
  bandsFromBigSmallCounts,
  countsFromRowMixBands,
  isRowMixActive,
  isStripRowMixActive,
  needsRowMixHint,
  normalizeStripRowMixBands,
  stripRowMixBandsFor,
  stripRowsForWallHeight,
  summarizeRowMix,
  suggestBigSmallMixForHeight,
} from '../lib/rowMix'

const METER_INPUT_DEBOUNCE_MS = 400

import ScreenManager from './ScreenManager'



interface SidebarProps {

  screens: ScreenConfig[]

  activeScreenId: string

  config: ScreenConfig

  onChange: (config: ScreenConfig) => void

  onSelectScreen: (id: string) => void

  onAddScreen: () => void

  onRemoveScreen: (id: string) => void

  onRenameScreen: (id: string, name: string) => void

  /** Полный сброс проекта (localStorage + defaults) */
  onResetProject: () => void

  emptyPaintMode: boolean

  onEmptyPaintModeChange: (enabled: boolean) => void

  gridLayout: GridLayout

  onGridLayoutChange: (layout: GridLayout) => void

  showCombinedPacking: boolean

  onShowCombinedPackingChange: (enabled: boolean) => void

  globalTotals?: {

    totalCabinets: number

    totalPixels: number

    totalEmpty: number

    screenCount: number

  }

  isOpen?: boolean

  onClose?: () => void

}



const TRUNK_OPTIONS: TrunkLengthM[] = [15, 30, 50]

const REFRESH_OPTIONS: RefreshRate[] = [50, 60]



function SectionTitle({ children }: { children: ReactNode }) {

  return (

    <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">

      {children}

    </h2>

  )

}



function Field({ label, children }: { label: string; children: ReactNode }) {

  return (

    <label className="block space-y-1">

      <span className="text-sm font-medium text-slate-700">{label}</span>

      {children}

    </label>

  )

}



const inputClass =

  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-base shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 sm:py-2 sm:text-sm'

/** Порог: больше этого значения — сначала подтверждение, без пересчёта сетки */
const STRIP_NUMBER_CONFIRM_THRESHOLD = 50

/**
 * Числовое поле с черновиком: можно вводить 0 и пустую строку.
 * При значении > 50 — сначала inline-подтверждение; onCommit (пересчёт) только
 * после «Да, применить». Отмена возвращает сохранённое значение.
 */
function ValidatedStripNumberInput({
  value,
  onCommit,
  fieldLabel,
  min = 1,
  max,
  className = inputClass,
}: {
  value: number
  onCommit: (next: number) => void
  fieldLabel: string
  min?: number
  max?: number
  className?: string
}) {
  const [draft, setDraft] = useState(String(value))
  const [error, setError] = useState<string | null>(null)
  const [pendingLarge, setPendingLarge] = useState<number | null>(null)
  const focusedRef = useRef(false)
  const pendingLargeRef = useRef<number | null>(null)

  useEffect(() => {
    pendingLargeRef.current = pendingLarge
  }, [pendingLarge])

  useEffect(() => {
    if (!focusedRef.current && pendingLargeRef.current == null) {
      setDraft(String(value))
      setError(null)
    }
  }, [value])

  const revert = () => {
    setDraft(String(value))
    setError(null)
    setPendingLarge(null)
  }

  /** force=true — явное подтверждение пользователем (кнопка «Да») */
  const applyValue = (val: number, force = false) => {
    if (val > STRIP_NUMBER_CONFIRM_THRESHOLD && !force) {
      setPendingLarge(val)
      return
    }
    setDraft(String(val))
    setError(null)
    setPendingLarge(null)
    if (val !== value) {
      window.setTimeout(() => {
        startTransition(() => onCommit(val))
      }, 0)
    }
  }

  const validateAndCommit = () => {
    if (pendingLargeRef.current != null) return

    setError(null)
    const raw = draft.trim()
    if (raw === '') {
      setError(`Введите число не меньше ${min}.`)
      setDraft(String(value))
      return
    }
    const val = parseInt(raw, 10)
    if (Number.isNaN(val)) {
      setError('Некорректное число.')
      setDraft(String(value))
      return
    }
    if (val < min) {
      setError(
        val === 0
          ? `0 недопустимо. Минимум — ${min}.`
          : `Минимум — ${min}.`,
      )
      setDraft(String(value))
      return
    }
    if (max != null && val > max) {
      setError(`Максимум — ${max}.`)
      setDraft(String(value))
      return
    }
    if (val > STRIP_NUMBER_CONFIRM_THRESHOLD) {
      setPendingLarge(val)
      return
    }
    applyValue(val)
  }

  const scheduleCommit = () => {
    window.setTimeout(() => validateAndCommit(), 0)
  }

  return (
    <div>
      <input
        type="text"
        inputMode="numeric"
        className={className}
        value={draft}
        onFocus={() => {
          focusedRef.current = true
        }}
        onChange={(e) => {
          setError(null)
          setPendingLarge(null)
          setDraft(e.target.value)
        }}
        onBlur={() => {
          focusedRef.current = false
          scheduleCommit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            focusedRef.current = false
            scheduleCommit()
          }
        }}
      />
      {error && (
        <p className="mt-0.5 text-[10px] font-medium text-red-600">
          {fieldLabel}: {error}
        </p>
      )}
      {pendingLarge != null && (
        <div
          className="mt-1 space-y-1 rounded border border-amber-400 bg-amber-50 p-1.5"
          role="alertdialog"
          aria-live="assertive"
        >
          <p className="text-[10px] leading-snug text-amber-950">
            {fieldLabel}: вы ввели {pendingLarge} (больше {STRIP_NUMBER_CONFIRM_THRESHOLD}).
            Пересчёт и отрисовка сетки не выполняются, пока вы не подтвердите.
          </p>
          <div className="flex gap-1">
            <button
              type="button"
              className="flex-1 rounded border border-amber-500 bg-white px-2 py-1 text-[10px] font-semibold text-slate-900 hover:bg-amber-100"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyValue(pendingLarge, true)}
            >
              Да, применить
            </button>
            <button
              type="button"
              className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
              onMouseDown={(e) => e.preventDefault()}
              onClick={revert}
            >
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  )
}



/** Микс Big/Small для одной полосы */
function StripRowMixPanel({
  stripIndex,
  stripLabel,
  bands,
  config,
  onChange,
  wallHeightM,
}: {
  stripIndex: number
  stripLabel: string
  bands: import('../types').RowMixBand[]
  config: ScreenConfig
  onChange: (config: ScreenConfig) => void
  wallHeightM: number
}) {
  const counts = countsFromRowMixBands(bands)
  const mixOn = isStripRowMixActive(bands)

  const commit = (bigRows: number, smallRows: number) => {
    const nextBands = bandsFromBigSmallCounts(bigRows, smallRows, false)
    const all = stripRowMixBandsFor(config)
    all[stripIndex] = nextBands
    if (nextBands.length === 0) {
      onChange(syncCabinetGridFromMeters({ ...config, stripRowMixBands: all }))
      return
    }
    onChange(syncCabinetGridFromMeters(applyStripRowMixBands(config, all)))
  }

  const enableFromWall = () => {
    const suggestion = suggestBigSmallMixForHeight(wallHeightM)
    if (suggestion && suggestion.bigRows + suggestion.smallRows > 0) {
      commit(suggestion.bigRows, suggestion.smallRows)
      return
    }
    commit(4, 3)
  }

  return (
    <div className="space-y-2 rounded border border-amber-200 bg-amber-50/60 p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-slate-800">
            Микс Big / Small — {stripLabel}
          </p>
          <p className="mt-0.5 text-[10px] leading-snug text-slate-600">
            Нижние ряды Big (1 м), верхние Small (0.5 м). Пример: 4+3 → 5.5 м.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={mixOn}
          aria-label={`Микс Big/Small — ${stripLabel}`}
          onClick={() => {
            if (mixOn) {
              const all = stripRowMixBandsFor(config)
              all[stripIndex] = []
              onChange(syncCabinetGridFromMeters({ ...config, stripRowMixBands: all }))
            } else {
              enableFromWall()
            }
          }}
          className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition ${
            mixOn ? 'bg-amber-600' : 'bg-slate-300'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${
              mixOn ? 'translate-x-5' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
      {mixOn && (
        <div className="space-y-2 rounded border border-amber-200 bg-white p-2">
          <label className="block text-[10px] font-medium text-slate-600">
            Нижние линии 3.9 Big (по 1 м)
            <input
              type="number"
              min={0}
              max={40}
              className={`${inputClass} mt-0.5`}
              value={counts.bigRows}
              onChange={(e) => {
                const big = Math.max(0, parseInt(e.target.value, 10) || 0)
                commit(big, counts.smallRows)
              }}
            />
          </label>
          <label className="block text-[10px] font-medium text-slate-600">
            Верхние линии 3.9 Small (по 0.5 м)
            <input
              type="number"
              min={0}
              max={40}
              className={`${inputClass} mt-0.5`}
              value={counts.smallRows}
              onChange={(e) => {
                const small = Math.max(0, parseInt(e.target.value, 10) || 0)
                commit(counts.bigRows, small)
              }}
            />
          </label>
          {(() => {
            const sum = summarizeRowMix(
              bandsFromBigSmallCounts(counts.bigRows, counts.smallRows, false),
            )
            return (
              <p className="text-[10px] text-slate-600">
                {sum.cabinetsHigh} ряд. · {sum.wallHeightM.toFixed(1)} м ·{' '}
                {sum.pixelsHigh} px по вертикали на этой полосе.
              </p>
            )
          })()}
        </div>
      )}
    </div>
  )
}



const readOnlyClass =

  'w-full rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5 text-base text-slate-600 sm:py-2 sm:text-sm'



const toggleBtnClass =

  'touch-manipulation min-h-[44px] flex-1 rounded-md px-2 py-2 text-xs font-medium transition sm:min-h-0 sm:py-1.5'



const switchClass =

  'relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition sm:h-7 sm:w-12'



const switchKnobClass =

  'inline-block h-6 w-6 transform rounded-full bg-white shadow transition sm:h-5 sm:w-5'



export default function Sidebar({

  screens,

  activeScreenId,

  config,

  onChange,

  onSelectScreen,

  onAddScreen,

  onRemoveScreen,

  onRenameScreen,

  onResetProject,

  emptyPaintMode,

  onEmptyPaintModeChange,

  gridLayout,

  onGridLayoutChange,

  showCombinedPacking,

  onShowCombinedPackingChange,

  globalTotals,

  isOpen = false,

  onClose,

}: SidebarProps) {

  const update = <K extends keyof ScreenConfig>(key: K, value: ScreenConfig[K]) => {

    onChange(syncCabinetGridFromMeters({ ...config, [key]: value }))

  }

  const stripCount = config.stripWidths?.length ?? 1
  const canDualVx = stripCount > 1

  const otherScreens = screens.filter((s) => s.id !== config.id)

  const applyStripCount = (count: number) => {
    const n = Math.max(1, Math.min(count, config.cabinetsWide))
    onChange(
      syncCabinetGridFromMeters({
        ...config,
        stripWidths: equalStripWidths(n, config.cabinetsWide),
        stripHeights: normalizeStripHeights(config.stripHeights, n, config.cabinetsHigh),
        stripControllerIds: normalizeStripControllerIds(config.stripControllerIds, n),
        stripPitchConfigs: normalizeStripPitchConfigs(config.stripPitchConfigs, n),
        stripRowMixBands: normalizeStripRowMixBands(
          config.stripRowMixBands,
          n,
          config.rowMixBands,
        ),
      }),
    )
  }

  /** Полосы с кубиками с других экранов проекта (≥2 блока) */
  const applyMixFromScreens = () => {
    const mix = buildStripMixFromScreens(config, screens)
    if (!mix) return
    onChange(
      syncCabinetGridFromMeters({
        ...config,
        ...mix,
        stripRowMixBands: [],
      }),
    )
  }

  const stripRowMixAll = stripRowMixBandsFor(config)
  const rowMixOn = isRowMixActive(config)

  const applyDualVx1000 = (next: boolean) => {
    onChange(
      syncCabinetGridFromMeters({
        ...config,
        dualVx1000: next,
        stripControllerIds: next
          ? normalizeStripControllerIds(
              config.stripControllerIds?.length === stripCount
                ? config.stripControllerIds
                : defaultStripControllerIds(stripCount),
              stripCount,
            )
          : normalizeStripControllerIds(config.stripControllerIds, stripCount),
        ...(next && config.controllerModel !== 'NovaStar VX1000'
          ? { controllerModel: 'NovaStar VX1000' as ControllerModel }
          : {}),
      }),
    )
  }

  const updateInt = (key: keyof ScreenConfig, raw: string, min = 1) => {

    const val = Math.max(min, parseInt(raw, 10) || min)

    update(key, val as ScreenConfig[typeof key])

  }



  const [widthDraft, setWidthDraft] = useState(String(config.wallWidthM))
  const [heightDraft, setHeightDraft] = useState(String(config.wallHeightM))

  useEffect(() => {
    setWidthDraft(String(config.wallWidthM))
  }, [config.id, config.wallWidthM])

  useEffect(() => {
    setHeightDraft(String(config.wallHeightM))
  }, [config.id, config.wallHeightM])

  const configRef = useRef(config)
  configRef.current = config

  const commitWidthDraft = (raw: string) => {
    const parsed = parseMeterDraftForCommit(raw)
    if (parsed === null) {
      setWidthDraft(String(configRef.current.wallWidthM))
      return
    }
    if (parsed < MIN_WALL_DIMENSION_M) {
      window.alert(`Минимальная ширина стены — ${MIN_WALL_DIMENSION_M} м.`)
      setWidthDraft(String(configRef.current.wallWidthM))
      return
    }
    const clamped = clampWallDimensionM(parsed)
    setWidthDraft(String(clamped))
    if (Math.abs(clamped - configRef.current.wallWidthM) >= 0.0001) {
      onChange(syncCabinetGridFromMeters({ ...configRef.current, wallWidthM: clamped }))
    }
  }

  const commitHeightDraft = (raw: string) => {
    const parsed = parseMeterDraftForCommit(raw)
    if (parsed === null) {
      setHeightDraft(String(configRef.current.wallHeightM))
      return
    }
    if (parsed < MIN_WALL_DIMENSION_M) {
      window.alert(`Минимальная высота стены — ${MIN_WALL_DIMENSION_M} м.`)
      setHeightDraft(String(configRef.current.wallHeightM))
      return
    }
    const clamped = clampWallDimensionM(parsed)
    setHeightDraft(String(clamped))
    if (Math.abs(clamped - configRef.current.wallHeightM) >= 0.0001) {
      let next: ScreenConfig = { ...configRef.current, wallHeightM: clamped }
      if (isRowMixActive(next)) {
        next = {
          ...next,
          stripRowMixBands: stripRowMixBandsFor(next).map(() => []),
        }
      }
      onChange(syncCabinetGridFromMeters(next))
    }
  }

  useEffect(() => {
    const widthVal = parseMeterDraftForCommit(widthDraft)
    if (widthVal === null || widthVal < MIN_WALL_DIMENSION_M) return
    const clamped = clampWallDimensionM(widthVal)
    if (Math.abs(clamped - configRef.current.wallWidthM) < 0.0001) return

    const timer = window.setTimeout(() => {
      onChange(syncCabinetGridFromMeters({ ...configRef.current, wallWidthM: clamped }))
    }, METER_INPUT_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [widthDraft, onChange])

  useEffect(() => {
    const heightVal = parseMeterDraftForCommit(heightDraft)
    if (heightVal === null || heightVal < MIN_WALL_DIMENSION_M) return
    const clamped = clampWallDimensionM(heightVal)
    if (Math.abs(clamped - configRef.current.wallHeightM) < 0.0001) return

    const timer = window.setTimeout(() => {
      let next: ScreenConfig = { ...configRef.current, wallHeightM: clamped }
      if (isRowMixActive(next)) {
        next = {
          ...next,
          stripRowMixBands: stripRowMixBandsFor(next).map(() => []),
        }
      }
      onChange(syncCabinetGridFromMeters(next))
    }, METER_INPUT_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [heightDraft, onChange])

  /** Включить микс на полосе 0 из текущей высоты стены */
  const enableRowMixFromWall = (stripIndex = 0) => {
    const heightM = previewMeterFromDraft(heightDraft, config.wallHeightM)
    const suggestion = suggestBigSmallMixForHeight(heightM)
    const all = stripRowMixBandsFor(config)
    const bands =
      suggestion && suggestion.bigRows + suggestion.smallRows > 0
        ? bandsFromBigSmallCounts(suggestion.bigRows, suggestion.smallRows, false)
        : bandsFromBigSmallCounts(4, 3, false)
    all[stripIndex] = bands
    onChange(syncCabinetGridFromMeters(applyStripRowMixBands(config, all)))
  }

  const previewGrid = useMemo(() => {
    const widthM = previewMeterFromDraft(widthDraft, config.wallWidthM)
    if (isRowMixActive(config)) {
      const stripWidths = normalizeStripWidths(config.stripWidths, config.cabinetsWide)
      const perStripRows = stripRowMixAll.map((bands, i) => {
        if (isStripRowMixActive(bands)) {
          return summarizeRowMix(bands).cabinetsHigh
        }
        const geo = resolveStripPitch({ ...config, stripWidths }, i, screens)
        return stripRowsForWallHeight(
          previewMeterFromDraft(heightDraft, config.wallHeightM),
          geo.cabinetHeightMm,
        )
      })
      return {
        cabinetsWide: calcCabinetsFromMeters(
          widthM,
          config.wallHeightM,
          config.cabinetWidthMm,
          config.cabinetHeightMm,
        ).cabinetsWide,
        cabinetsHigh: Math.max(...perStripRows, 1),
        stripRowHint: null as string | null,
      }
    }
    const heightM = previewMeterFromDraft(heightDraft, config.wallHeightM)
    const stripWidths = normalizeStripWidths(config.stripWidths, config.cabinetsWide)
    const pitchConfigs = normalizeStripPitchConfigs(
      config.stripPitchConfigs,
      stripWidths.length,
    )
    if (stripWidths.length > 1) {
      const perStripRows = stripWidths.map((_, i) => {
        const geo = resolveStripPitch(
          { ...config, stripWidths, stripPitchConfigs: pitchConfigs },
          i,
          screens,
        )
        return stripRowsForWallHeight(heightM, geo.cabinetHeightMm)
      })
      const cabinetsHigh = Math.max(...perStripRows, 1)
      const cabinetsWide = calcCabinetsFromMeters(
        widthM,
        heightM,
        config.cabinetWidthMm,
        config.cabinetHeightMm,
      ).cabinetsWide
      const stripRowHint = perStripRows
        .map((rows, i) => {
          const geo = resolveStripPitch(
            { ...config, stripWidths, stripPitchConfigs: pitchConfigs },
            i,
            screens,
          )
          return `блок ${i + 1}: ${rows} ряд. (${geo.cabinetHeightMm} mm)`
        })
        .join(' · ')
      return { cabinetsWide, cabinetsHigh, stripRowHint }
    }
    const grid = calcCabinetsFromMeters(
      widthM,
      heightM,
      config.cabinetWidthMm,
      config.cabinetHeightMm,
    )
    return { ...grid, stripRowHint: null as string | null }
  }, [
    widthDraft,
    heightDraft,
    config,
    screens,
  ])

  const heightMixHint = useMemo(() => {
    const heightM = previewMeterFromDraft(heightDraft, config.wallHeightM)
    return needsRowMixHint(
      heightM,
      config.cabinetHeightMm,
      rowMixOn,
      config.pitchPreset,
    )
  }, [heightDraft, config.wallHeightM, config.cabinetHeightMm, config.pitchPreset, rowMixOn])

  const isDimensionPending =
    previewGrid.cabinetsWide !== config.cabinetsWide ||
    previewGrid.cabinetsHigh !== config.cabinetsHigh

  const isPreset = config.pitchPreset !== 'custom'

  const activePreset = isPreset ? getPitchPreset(config.pitchPreset) : undefined

  const powerLineLimitHint = getPowerLineLimitHint(config)

  const { pixelsWide, pixelsHigh } = calcPixelsPerCabinet(config)



  const handlePresetChange = (presetId: PitchPresetId) => {
    // Смена пресета сбрасывает микс рядов
    onChange(
      syncCabinetGridFromMeters(
        applyPitchPreset({ ...config, stripRowMixBands: [] }, presetId),
      ),
    )
  }



  return (

    <aside

      className={`sidebar-print-hide fixed inset-y-0 left-0 z-50 flex h-full w-[min(100vw,20rem)] flex-col overflow-y-auto border-r border-slate-200 bg-white transition-transform duration-300 ease-in-out md:static md:z-auto md:w-80 md:max-w-none md:shrink-0 md:translate-x-0 ${

        isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'

      }`}

    >

      <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">

        <div>

        <h1 className="text-lg font-bold text-slate-900">LED Cable Mapper</h1>

        <p className="mt-0.5 text-xs text-slate-500">Video Wall Routing &amp; Billing</p>

        </div>

        {onClose && (

          <button

            type="button"

            aria-label="Закрыть меню"

            onClick={onClose}

            className="touch-manipulation rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 md:hidden"

          >

            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>

              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />

            </svg>

          </button>

        )}

      </div>



      <div className="flex flex-1 flex-col gap-6 px-5 py-5">

        <ScreenManager

          screens={screens}

          activeScreenId={activeScreenId}

          onSelect={onSelectScreen}

          onAdd={onAddScreen}

          onRemove={onRemoveScreen}

          onRename={onRenameScreen}

        />



        {globalTotals && globalTotals.screenCount > 1 && (

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">

            <p className="font-semibold text-slate-700">Project total</p>

            <p>

              {globalTotals.totalCabinets} cabinets ·{' '}

              {globalTotals.totalPixels.toLocaleString()} px

              {globalTotals.totalEmpty > 0 && ` · ${globalTotals.totalEmpty} empty`}

            </p>

          </div>

        )}



        <section className="space-y-3">

          <SectionTitle>Screen — {config.name}</SectionTitle>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">

            <Field label="Wall Width (m)">

              <input

                type="text"

                inputMode="decimal"

                autoComplete="off"

                className={inputClass}

                value={widthDraft}

                onChange={(e) => {
                  const next = e.target.value
                  if (isMeterDraftEditable(next)) setWidthDraft(next)
                }}

                onBlur={() => commitWidthDraft(widthDraft)}

              />

            </Field>

            <Field label="Wall Height (m)">

              <input

                type="text"

                inputMode="decimal"

                autoComplete="off"

                className={inputClass}

                value={heightDraft}

                title={
                  rowMixOn
                    ? 'Смена высоты сбросит микс Big/Small на полосах'
                    : undefined
                }

                onChange={(e) => {
                  const next = e.target.value
                  if (isMeterDraftEditable(next)) setHeightDraft(next)
                }}

                onBlur={() => commitHeightDraft(heightDraft)}

              />

            </Field>

          </div>

          <p className="text-[10px] text-slate-400">min 0.5 m</p>

          <p className="text-[10px] text-slate-400">
            → {previewGrid.cabinetsWide} × {previewGrid.cabinetsHigh} cabinets (
            {config.cabinetWidthMm}×{config.cabinetHeightMm} mm)
            {previewGrid.stripRowHint && (
              <span className="block text-slate-500">{previewGrid.stripRowHint}</span>
            )}
            {isDimensionPending && (
              <span className="ml-1 text-amber-600">· расчёт через 0.4 с</span>
            )}
          </p>

          {heightMixHint && !rowMixOn && (
            <div className="space-y-1.5 rounded-md border border-amber-300 bg-amber-50 p-2">
              <p className="text-[10px] leading-snug text-amber-900">
                {heightMixHint.halfMeter ? (
                  <>
                    {heightMixHint.requestedM} м — сверху остаётся{' '}
                    {heightMixHint.remainderM.toFixed(1)} м (половина метра). Добавьте{' '}
                    {heightMixHint.suggestion.smallRows} ряд(ов) 3.9 Small (0.5 м) поверх{' '}
                    {heightMixHint.suggestion.bigRows > 0
                      ? `${heightMixHint.suggestion.bigRows} Big`
                      : 'основания'}
                    .
                  </>
                ) : (
                  <>
                    {heightMixHint.requestedM} м не набирается только из Big (макс.{' '}
                    {heightMixHint.maxBigOnlyM} м = {heightMixHint.bigRowsOnly} ряд.). Добавьте
                    верхние ряды из Small.
                  </>
                )}
              </p>
              {heightMixHint.suggestion && (
                <button
                  type="button"
                  className="w-full rounded-md border border-amber-400 bg-white px-2 py-1.5 text-[10px] font-semibold text-slate-900 hover:bg-amber-100"
                  onClick={() => enableRowMixFromWall(0)}
                >
                  Микс: {heightMixHint.suggestion.bigRows} Big +{' '}
                  {heightMixHint.suggestion.smallRows} Small ={' '}
                  {heightMixHint.suggestion.totalM} м
                </button>
              )}
            </div>
          )}

          <Field label="Подвес / Hang / תלייה">
            <button
              type="button"
              role="switch"
              aria-checked={config.hangMount}
              onClick={() => update('hangMount', !config.hangMount)}
              className={`${switchClass} ${
                config.hangMount ? 'bg-green-500' : 'bg-slate-300'
              }`}
            >
              <span
                className={`${switchKnobClass} ${
                  config.hangMount ? 'translate-x-7 sm:translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <span className="ml-2 text-xs text-slate-500">
              {config.hangMount ? 'ON — тросы/подвес по м' : 'OFF — шпрайцы'}
            </span>
          </Field>

          <Field label="Strips / Полосы (отдельные блоки)">
            <select
              className={inputClass}
              value={stripCount}
              onChange={(e) => {
                const count = Math.max(1, parseInt(e.target.value, 10) || 1)
                applyStripCount(count)
              }}
            >
              {Array.from(
                { length: Math.min(8, config.cabinetsWide) },
                (_, i) => i + 1,
              ).map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? '1 — один экран' : `${n} блока (data + power отдельно)`}
                </option>
              ))}
            </select>
          </Field>

          {stripCount > 1 && (
            <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50/70 p-2.5">
              <p className="text-[11px] font-semibold text-slate-800">
                Кубики по блокам (ширина)
              </p>
              <p className="text-[10px] leading-snug text-slate-600">
                При нескольких полосах — модель кубика на каждый блок (Big / Small
                / Reshet / 2.9) или с другого экрана. Микс Big/Small — отдельно
                на каждой полосе ниже.
              </p>
              {otherScreens.length > 0 && (
                <button
                  type="button"
                  className="w-full rounded-md border border-amber-400 bg-amber-100 px-2.5 py-1.5 text-[11px] font-semibold text-slate-900 hover:bg-amber-200"
                  onClick={applyMixFromScreens}
                >
                  Собрать из экранов (
                  {otherScreens
                    .slice(0, Math.min(otherScreens.length, config.cabinetsWide))
                    .map((s) => s.name)
                    .join(', ')}
                  )
                </button>
              )}
            </div>
          )}

          <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2.5">
              <p className="text-[10px] text-slate-500">
                {stripCount > 1
                  ? `Каждый стрип — отдельный блок. Ширина в колонках (сумма = ${config.cabinetsWide}).`
                  : 'Один экран — настройки полосы и микс Big/Small ниже.'}
                {' '}
                Высота стены {config.cabinetsHigh} ряд. (max по полосам).
              </p>
              <div className="space-y-2">
                {(config.stripWidths ?? [config.cabinetsWide]).map((w, i) => {
                  const stripMixOn = isStripRowMixActive(stripRowMixAll[i])
                  const pitchConfigs = normalizeStripPitchConfigs(
                    config.stripPitchConfigs,
                    config.stripWidths?.length ?? 1,
                  )
                  const stripHeights = normalizeStripHeights(
                    config.stripHeights,
                    config.stripWidths?.length ?? 1,
                    Math.max(
                      config.cabinetsHigh,
                      ...(config.stripHeights ?? []),
                    ),
                  )
                  const pitch = pitchConfigs[i] ?? inheritStripPitch()
                  const resolved = resolveStripPitch(config, i, screens)
                  const stripHigh = stripHeights[i] ?? config.cabinetsHigh
                  const cabinetSelectValue =
                    pitch.kind === 'inherit'
                      ? 'inherit'
                      : pitch.kind === 'preset' &&
                          pitch.pitchPreset &&
                          pitch.pitchPreset !== 'custom'
                        ? `preset:${pitch.pitchPreset}`
                        : pitch.kind === 'screen' && pitch.screenId
                          ? `screen:${pitch.screenId}`
                          : 'inherit'
                  return (
                    <div
                      key={i}
                      className="rounded border border-slate-200 bg-white p-2 space-y-1.5"
                    >
                      <p className="text-[11px] font-semibold text-slate-700">
                        Strip {i + 1}
                      </p>
                      <div className="flex flex-col gap-2">
                        <label className="block text-[10px] font-medium text-slate-600">
                          Кубик (из списка)
                          <select
                            className={`${inputClass} mt-0.5`}
                            value={cabinetSelectValue}
                            onChange={(e) => {
                              const v = e.target.value
                              const next = [...pitchConfigs]
                              if (v === 'inherit') {
                                next[i] = inheritStripPitch()
                              } else if (v.startsWith('preset:')) {
                                next[i] = stripPitchFromPreset(
                                  v.slice('preset:'.length) as PitchPresetId,
                                )
                              } else if (v.startsWith('screen:')) {
                                const sid = v.slice('screen:'.length)
                                const src = screens.find((s) => s.id === sid)
                                if (!src) return
                                next[i] = stripPitchFromScreen(sid, src)
                              }
                              update('stripPitchConfigs', next)
                            }}
                          >
                            <option value="inherit">
                              Как у экрана (
                              {config.cabinetWidthMm}×{config.cabinetHeightMm} mm)
                            </option>
                            {PITCH_PRESETS.map((p) => (
                              <option key={p.id} value={`preset:${p.id}`}>
                                {p.label} — {p.cabinetWidthMm}×{p.cabinetHeightMm} mm
                              </option>
                            ))}
                            {otherScreens.map((s) => (
                              <option key={s.id} value={`screen:${s.id}`}>
                                С экрана «{s.name}» — {s.cabinetWidthMm}×
                                {s.cabinetHeightMm} mm
                              </option>
                            ))}
                          </select>
                        </label>
                        {stripCount > 1 && (
                        <label className="block text-[10px] font-medium text-slate-600">
                          Размер стрипа (колонки)
                          <ValidatedStripNumberInput
                            className={`${inputClass} mt-0.5`}
                            fieldLabel={`Strip ${i + 1}, ширина`}
                            value={w}
                            max={
                              config.cabinetsWide -
                              ((config.stripWidths?.length ?? 1) - 1)
                            }
                            onCommit={(val) => {
                              update(
                                'stripWidths',
                                setStripWidthAt(
                                  config.stripWidths ?? [config.cabinetsWide],
                                  i,
                                  val,
                                  config.cabinetsWide,
                                ),
                              )
                            }}
                          />
                        </label>
                        )}
                        <StripRowMixPanel
                          stripIndex={i}
                          stripLabel={`Strip ${i + 1}`}
                          bands={stripRowMixAll[i] ?? []}
                          config={config}
                          onChange={onChange}
                          wallHeightM={config.wallHeightM}
                        />
                        <label className="block text-[10px] font-medium text-slate-600">
                          Размер стрипа (высота)
                          {stripMixOn ? (
                            <span className={`${inputClass} mt-0.5 block bg-slate-50 text-slate-600`}>
                              {stripHigh} ряд. (из микса Big/Small)
                            </span>
                          ) : (
                            <ValidatedStripNumberInput
                              className={`${inputClass} mt-0.5`}
                              fieldLabel={`Strip ${i + 1}, высота`}
                              value={stripHigh}
                              onCommit={(val) => {
                                onChange(applyStripHeightAt(config, i, val))
                              }}
                            />
                          )}
                        </label>
                      </div>
                      <p className="text-[10px] text-slate-400">
                        Кубик {resolved.cabinetWidthMm}×{resolved.cabinetHeightMm} mm ·{' '}
                        {resolved.pixelsWide}×{resolved.pixelsHigh} px · {w}×{stripHigh}{' '}
                        cab
                        {resolved.isOverride ? '' : ' · как экран'}
                      </p>
                    </div>
                  )
                })}
              </div>
              <p className="text-[10px] text-slate-400">
                Σ {(config.stripWidths ?? []).reduce((a, b) => a + b, 0)} /{' '}
                {config.cabinetsWide} cab · высота стены {config.cabinetsHigh} ряд.
              </p>
            </div>

          {/* 2× VX1000: всегда под Strips — при 1 полосе подсказка, при ≥2 — toggle */}
          {!canDualVx ? (
            <div className="space-y-2 rounded-lg border-2 border-dashed border-blue-300 bg-blue-50/80 p-3 shadow-sm">
              <p className="text-sm font-semibold text-slate-900">
                2× VX1000 / Два контроллера
              </p>
              <p className="text-[11px] leading-snug text-slate-600">
                Выберите ≥2 полосы в списке Strips выше, чтобы включить 2× VX1000
                (только тикшорет/data). Края → VX1, центр → VX2.
              </p>
              {config.cabinetsWide < 2 && (
                <p className="text-[11px] text-amber-700">
                  Нужно ≥2 кабинета по ширине, чтобы разбить экран на полосы.
                </p>
              )}
            </div>
          ) : (
            <div
              className={`space-y-3 rounded-lg border-2 p-3 shadow-sm ${
                config.dualVx1000
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-blue-300 bg-blue-50/70'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">
                    2× VX1000 / Два контроллера
                  </p>
                  <p className="mt-1 text-[11px] leading-snug text-slate-600">
                    Только тикшорет/data: края → VX1, центр → VX2. Порты D1-1, D2-1… Электричество без изменений.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(config.dualVx1000)}
                  aria-label="2× VX1000 / два контроллера"
                  onClick={() => applyDualVx1000(!config.dualVx1000)}
                  className={`relative inline-flex h-9 w-16 shrink-0 items-center rounded-full transition ${
                    config.dualVx1000 ? 'bg-blue-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`inline-block h-7 w-7 transform rounded-full bg-white shadow transition ${
                      config.dualVx1000 ? 'translate-x-8' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <p className="text-[11px] font-medium text-slate-700">
                {config.dualVx1000
                  ? 'Включено — два VX1000, data-порты D1-1 / D2-1 (power: P1, P2…)'
                  : 'Выключено — один контроллер, обычная нумерация D1, P1'}
              </p>

              {config.dualVx1000 && (
                <div className="space-y-2 rounded-md border border-blue-200 bg-white p-2.5">
                  <p className="text-xs font-semibold text-slate-800">
                    Назначение стрипов → Controller
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {(config.stripWidths ?? [config.cabinetsWide]).map((_, i) => {
                      const ids = normalizeStripControllerIds(
                        config.stripControllerIds,
                        stripCount,
                      )
                      return (
                        <label
                          key={`ctrl-${i}`}
                          className="block text-[11px] font-medium text-slate-700"
                        >
                          Strip {i + 1}
                          <select
                            className={`${inputClass} mt-0.5`}
                            value={ids[i] ?? 1}
                            onChange={(e) => {
                              const ctrl =
                                parseInt(e.target.value, 10) === 2 ? 2 : 1
                              const next = [...ids]
                              next[i] = ctrl
                              update('stripControllerIds', next)
                            }}
                          >
                            <option value={1}>Controller 1</option>
                            <option value={2}>Controller 2</option>
                          </select>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

        </section>



        <section className="space-y-3">

          <SectionTitle>Pixel Pitch / Cabinet</SectionTitle>

          <Field label="Pixel Pitch Preset / Шаг пикселя">

            <select

              className={inputClass}

              value={config.pitchPreset}

              onChange={(e) => handlePresetChange(e.target.value as PitchPresetId)}

            >

              {PITCH_PRESETS.map((p) => (

                <option key={p.id} value={p.id}>

                  {p.label} — {p.pixelPitchMm} mm

                </option>

              ))}

              <option value="custom">{CUSTOM_PRESET_LABEL}</option>

            </select>

          </Field>



          {isPreset && activePreset ? (

            <>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">

                <Field label="Cabinet W×H (mm)">

                  <div className={readOnlyClass}>

                    {activePreset.cabinetWidthMm} × {activePreset.cabinetHeightMm}

                  </div>

                </Field>

                <Field label="Pixels / Cabinet">

                  <div className={readOnlyClass}>

                    {activePreset.pixelsWide} × {activePreset.pixelsHigh}

                  </div>

                </Field>

              </div>

              <p className="text-[10px] text-slate-400">

                Pitch {activePreset.pixelPitchMm} mm · {pixelsWide * pixelsHigh} px/cabinet

              </p>

            </>

          ) : (

            <>

              <div className="flex rounded-lg border border-slate-200 p-0.5">

                {(['pitch', 'pixels'] as CustomDensityInput[]).map((mode) => (

                  <button

                    key={mode}

                    type="button"

                    onClick={() => update('customDensityInput', mode)}

                    className={`${toggleBtnClass} ${

                      config.customDensityInput === mode

                        ? 'bg-blue-600 text-white shadow-sm'

                        : 'text-slate-600 hover:bg-slate-50'

                    }`}

                  >

                    {mode === 'pitch' ? 'From Pitch' : 'Direct Pixels'}

                  </button>

                ))}

              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">

                <Field label="Width (mm)">

                  <input

                    type="number"

                    min={100}

                    className={inputClass}

                    value={config.cabinetWidthMm}

                    onChange={(e) => updateInt('cabinetWidthMm', e.target.value, 100)}

                  />

                </Field>

                <Field label="Height (mm)">

                  <input

                    type="number"

                    min={100}

                    className={inputClass}

                    value={config.cabinetHeightMm}

                    onChange={(e) => updateInt('cabinetHeightMm', e.target.value, 100)}

                  />

                </Field>

              </div>

              {config.customDensityInput === 'pitch' ? (

                <>

                  <Field label="Pixel Pitch (mm)">

                    <input

                      type="number"

                      min={0.5}

                      step={0.1}

                      className={inputClass}

                      value={config.pixelPitchMm}

                      onChange={(e) =>

                        update('pixelPitchMm', parseFloat(e.target.value) || 2.5)

                      }

                    />

                  </Field>

                  <p className="text-[10px] text-slate-400">

                    Calculated: {pixelsWide} × {pixelsHigh} px/cabinet

                  </p>

                </>

              ) : (

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">

                  <Field label="Pixels Wide">

                    <input

                      type="number"

                      min={1}

                      className={inputClass}

                      value={config.customPixelsWide}

                      onChange={(e) => updateInt('customPixelsWide', e.target.value)}

                    />

                  </Field>

                  <Field label="Pixels High">

                    <input

                      type="number"

                      min={1}

                      className={inputClass}

                      value={config.customPixelsHigh}

                      onChange={(e) => updateInt('customPixelsHigh', e.target.value)}

                    />

                  </Field>

                </div>

              )}

            </>

          )}



          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">

            <Field label="Max Power / Cabinet (W)">

              <input

                type="number"

                min={50}

                className={inputClass}

                value={config.maxPowerPerCabinetW}

                onChange={(e) => updateInt('maxPowerPerCabinetW', e.target.value, 50)}

              />

            </Field>

            <Field label="Avg Power / Cabinet (W)">

              <input

                type="number"

                min={25}

                className={inputClass}

                value={config.avgPowerPerCabinetW}

                onChange={(e) => updateInt('avgPowerPerCabinetW', e.target.value, 25)}

              />

            </Field>

          </div>

          <p className="text-[10px] text-slate-400">

            {powerLineLimitHint} (auto target)

          </p>

        </section>



        <section className="space-y-3">

          <SectionTitle>Controller &amp; Cabling</SectionTitle>

          <Field label="Controller Model">

            <select

              className={inputClass}

              value={config.controllerModel}

              onChange={(e) => update('controllerModel', e.target.value as ControllerModel)}

            >

              {CONTROLLER_MODELS.map((c) => (

                <option key={c} value={c}>

                  {c}

                </option>

              ))}

            </select>

          </Field>

          <Field label="Signal Backup (V-Backup)">

            <button

              type="button"

              role="switch"

              aria-checked={config.signalBackup}

              onClick={() => update('signalBackup', !config.signalBackup)}

              className={`${switchClass} ${

                config.signalBackup ? 'bg-green-500' : 'bg-slate-300'

              }`}

            >

              <span

                className={`${switchKnobClass} ${

                  config.signalBackup ? 'translate-x-7 sm:translate-x-6' : 'translate-x-1'

                }`}

              />

            </button>

            <span className="ml-2 text-xs text-slate-500">

              {config.signalBackup ? 'Enabled' : 'Disabled'}

            </span>

          </Field>

          {config.signalBackup && (
            <Field label="Нумерация Data / Backup">
              <select
                className={inputClass}
                value={config.backupPortMode ?? 'auto'}
                onChange={(e) => {
                  const mode = e.target.value as 'auto' | 'manual'
                  if (mode === 'auto') {
                    onChange({
                      ...config,
                      backupPortMode: 'auto',
                      mainPortDisplayNumbers: {},
                      backupPortDisplayNumbers: {},
                    })
                  } else {
                    onChange({ ...config, backupPortMode: 'manual' })
                  }
                }}
              >
                <option value="auto">
                  Авто (≤5 — следующие порты; 6–10 — CVT10 Main/Backup)
                </option>
                <option value="manual">Вручную (номера на схеме)</option>
              </select>
              <p className="mt-1 text-[10px] text-slate-400">
                Ручные номера правятся под легендой Data на схеме.
              </p>
            </Field>
          )}

          <Field label="Trunk Length to Control Room">

            <select

              className={inputClass}

              value={config.trunkLengthM}

              onChange={(e) =>

                update('trunkLengthM', parseInt(e.target.value, 10) as TrunkLengthM)

              }

            >

              {TRUNK_OPTIONS.map((m) => (

                <option key={m} value={m}>

                  {m}m

                </option>

              ))}

            </select>

          </Field>

          <Field label="Refresh Rate">

            <div className="flex rounded-lg border border-slate-200 p-0.5">

              {REFRESH_OPTIONS.map((hz) => (

                <button

                  key={hz}

                  type="button"

                  onClick={() => update('refreshRate', hz)}

                  className={`${toggleBtnClass} ${

                    config.refreshRate === hz

                      ? 'bg-blue-600 text-white shadow-sm'

                      : 'text-slate-600 hover:bg-slate-50'

                  }`}

                >

                  {hz} Hz

                </button>

              ))}

            </div>

          </Field>

        </section>



        <section className="space-y-3">

          <SectionTitle>Grid Editing</SectionTitle>

          <Field label="Empty / Пропущенный">

            <div className="flex items-center">

              <button

                type="button"

                role="switch"

                aria-checked={emptyPaintMode}

                onClick={() => onEmptyPaintModeChange(!emptyPaintMode)}

                className={`${switchClass} ${

                  emptyPaintMode ? 'bg-green-500' : 'bg-slate-300'

                }`}

              >

                <span

                  className={`${switchKnobClass} ${

                    emptyPaintMode ? 'translate-x-7 sm:translate-x-6' : 'translate-x-1'

                  }`}

                />

              </button>

              <span className="ml-2 text-xs text-slate-500">

                {emptyPaintMode

                  ? 'Click grid to mark empty'

                  : `Off · ${config.emptyCabinets.length} empty`}

              </span>

            </div>

          </Field>

          {config.emptyCabinets.length > 0 && (

            <button

              type="button"

              className="text-xs text-red-500 underline hover:text-red-700"

              onClick={() => onChange({ ...config, emptyCabinets: [] })}

            >

              Clear all empty ({config.emptyCabinets.length})

            </button>

          )}

        </section>



        <section className="space-y-3">

          <SectionTitle>Display</SectionTitle>

          <Field label="Grid Layout">

            <div className="flex rounded-lg border border-slate-200 p-0.5">

              <button

                type="button"

                onClick={() => onGridLayoutChange('side-by-side')}

                className={`${toggleBtnClass} ${

                  gridLayout === 'side-by-side'

                    ? 'bg-blue-600 text-white shadow-sm'

                    : 'text-slate-600 hover:bg-slate-50'

                }`}

              >

                Side by Side

              </button>

              <button

                type="button"

                onClick={() => onGridLayoutChange('stacked')}

                className={`${toggleBtnClass} ${

                  gridLayout === 'stacked'

                    ? 'bg-blue-600 text-white shadow-sm'

                    : 'text-slate-600 hover:bg-slate-50'

                }`}

              >

                Stacked

              </button>

            </div>

          </Field>

          {screens.length > 1 && (

            <Field label="Combined Packing List">

              <div className="flex items-center">

                <button

                  type="button"

                  role="switch"

                  aria-checked={showCombinedPacking}

                  onClick={() => onShowCombinedPackingChange(!showCombinedPacking)}

                  className={`${switchClass} ${

                    showCombinedPacking ? 'bg-blue-500' : 'bg-slate-300'

                  }`}

                >

                  <span

                    className={`${switchKnobClass} ${

                      showCombinedPacking ? 'translate-x-7 sm:translate-x-6' : 'translate-x-1'

                    }`}

                  />

                </button>

                <span className="ml-2 text-xs text-slate-500">

                  {showCombinedPacking ? 'Totals across all screens' : 'Per active screen'}

                </span>

              </div>

            </Field>

          )}

        </section>



        <section className="space-y-3">

          <SectionTitle>Routing</SectionTitle>

          <Field label="Power Line Direction / Направление питания">

            <div className="flex rounded-lg border border-slate-200 p-0.5">

              {(['right', 'left'] as ChainStartEdge[]).map((edge) => (

                <button

                  key={edge}

                  type="button"

                  onClick={() => update('chainStartEdge', edge)}

                  className={`${toggleBtnClass} ${

                    config.chainStartEdge === edge

                      ? 'bg-blue-600 text-white shadow-sm'

                      : 'text-slate-600 hover:bg-slate-50'

                  }`}

                >

                  {edge === 'right'
                    ? 'Right → Left / Справа налево'
                    : 'Left → Right / Слева направо'}

                </button>

              ))}

            </div>

            <p className="mt-1 text-[10px] text-slate-500">

              Тикшорет (data) всегда линиями справа налево. Здесь — только power / электричество.

            </p>

          </Field>

          <Field label="Power Feed / Подвод питания">

            <div className="flex rounded-lg border border-slate-200 p-0.5">

              {(['edge', 'center'] as PowerFeedMode[]).map((mode) => (

                <button

                  key={mode}

                  type="button"

                  onClick={() => update('powerFeedMode', mode)}

                  className={`${toggleBtnClass} ${

                    config.powerFeedMode === mode

                      ? 'bg-blue-600 text-white shadow-sm'

                      : 'text-slate-600 hover:bg-slate-50'

                  }`}

                >

                  {mode === 'edge' ? 'Edge / Край' : 'Center / Центр'}

                </button>

              ))}

            </div>

            <p className="mt-1 text-[10px] text-slate-500">

              Edge: daisy-chain на всю ширину от края. Center: старт в центре экрана —
              одна линия влево, другая вправо (без ветвления из кубика).

            </p>

          </Field>

        </section>



        <div className="mt-auto space-y-2 border-t border-slate-200 pt-3">
          <button
            type="button"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
            onClick={() =>
              onChange(
                createScreen({
                  id: config.id,
                  name: config.name,
                  emptyCabinets: config.emptyCabinets,
                }),
              )
            }
          >
            Сбросить экран к defaults
          </button>
          <button
            type="button"
            className="w-full rounded-lg border-2 border-red-600 bg-red-600 px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-white shadow-sm transition hover:bg-red-700 active:bg-red-800"
            onClick={onResetProject}
          >
            Обнулить проект — хард-ресет
          </button>
          <p className="text-[10px] leading-snug text-slate-400">
            Сохраняется в браузере на этом устройстве — после обновления страницы
            данные остаются. «Обнулить проект» мгновенно останавливает все
            процессы, чистит сохранение и перезагружает страницу.
          </p>
        </div>

      </div>

    </aside>

  )

}


