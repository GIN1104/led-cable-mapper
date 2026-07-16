import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

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
  equalStripWidths,
  isMeterDraftEditable,
  parseMeterDraftForCommit,
  previewMeterFromDraft,
  setStripWidthAt,
  syncCabinetGridFromMeters,
} from '../lib/cabinetGrid'

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
    const clamped = clampWallDimensionM(parsed)
    setHeightDraft(String(clamped))
    if (Math.abs(clamped - configRef.current.wallHeightM) >= 0.0001) {
      onChange(syncCabinetGridFromMeters({ ...configRef.current, wallHeightM: clamped }))
    }
  }

  useEffect(() => {
    const widthVal = parseMeterDraftForCommit(widthDraft)
    if (widthVal === null) return
    const clamped = clampWallDimensionM(widthVal)
    if (Math.abs(clamped - configRef.current.wallWidthM) < 0.0001) return

    const timer = window.setTimeout(() => {
      onChange(syncCabinetGridFromMeters({ ...configRef.current, wallWidthM: clamped }))
    }, METER_INPUT_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [widthDraft, onChange])

  useEffect(() => {
    const heightVal = parseMeterDraftForCommit(heightDraft)
    if (heightVal === null) return
    const clamped = clampWallDimensionM(heightVal)
    if (Math.abs(clamped - configRef.current.wallHeightM) < 0.0001) return

    const timer = window.setTimeout(() => {
      onChange(syncCabinetGridFromMeters({ ...configRef.current, wallHeightM: clamped }))
    }, METER_INPUT_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [heightDraft, onChange])

  const previewGrid = useMemo(() => {
    const widthM = previewMeterFromDraft(widthDraft, config.wallWidthM)
    const heightM = previewMeterFromDraft(heightDraft, config.wallHeightM)
    return calcCabinetsFromMeters(
      widthM,
      heightM,
      config.cabinetWidthMm,
      config.cabinetHeightMm,
    )
  }, [widthDraft, heightDraft, config.wallWidthM, config.wallHeightM, config.cabinetWidthMm, config.cabinetHeightMm])

  const isDimensionPending =
    previewGrid.cabinetsWide !== config.cabinetsWide ||
    previewGrid.cabinetsHigh !== config.cabinetsHigh

  const isPreset = config.pitchPreset !== 'custom'

  const activePreset = isPreset ? getPitchPreset(config.pitchPreset) : undefined

  const powerLineLimitHint = getPowerLineLimitHint(config)

  const { pixelsWide, pixelsHigh } = calcPixelsPerCabinet(config)



  const handlePresetChange = (presetId: PitchPresetId) => {

    onChange(syncCabinetGridFromMeters(applyPitchPreset(config, presetId)))

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
            {isDimensionPending && (
              <span className="ml-1 text-amber-600">· расчёт через 0.4 с</span>
            )}
          </p>

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
              value={config.stripWidths?.length ?? 1}
              onChange={(e) => {
                const count = Math.max(1, parseInt(e.target.value, 10) || 1)
                update(
                  'stripWidths',
                  equalStripWidths(count, config.cabinetsWide),
                )
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

          {(config.stripWidths?.length ?? 1) > 1 && (
            <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2.5">
              <p className="text-[10px] text-slate-500">
                Каждый стрип — отдельный блок: data и электричество считаются внутри полосы,
                линии не переходят через зазор. Ширина в кабинетах (сумма ={' '}
                {config.cabinetsWide}).
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(config.stripWidths ?? [config.cabinetsWide]).map((w, i) => (
                  <label key={i} className="block text-[10px] font-medium text-slate-600">
                    Strip {i + 1}
                    <input
                      type="number"
                      min={1}
                      max={config.cabinetsWide - ((config.stripWidths?.length ?? 1) - 1)}
                      className={`${inputClass} mt-0.5`}
                      value={w}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10)
                        if (Number.isNaN(val)) return
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
                ))}
              </div>
              <p className="text-[10px] text-slate-400">
                Σ {(config.stripWidths ?? []).reduce((a, b) => a + b, 0)} /{' '}
                {config.cabinetsWide} cab
              </p>
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

              Edge: подвод на краю полосы (FEED/START). Center: подвод в центре полосы — P★ и стрелки от центра.

            </p>

          </Field>

        </section>



        <button

          type="button"

          className="mt-auto text-xs text-slate-400 underline hover:text-slate-600"

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

          Reset screen to defaults

        </button>

      </div>

    </aside>

  )

}


