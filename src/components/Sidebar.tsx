import type { ReactNode } from 'react'

import type {

  ScreenConfig,

  ControllerModel,

  TrunkLengthM,

  RefreshRate,

  GridLayout,

  ChainStartEdge,

  PitchPresetId,

  CustomDensityInput,

} from '../types'

import { createScreen } from '../types'

import { getPowerLineLimitHint } from '../lib/constants'

import {

  PITCH_PRESETS,

  CUSTOM_PRESET_LABEL,

  applyPitchPreset,

  getPitchPreset,

} from '../lib/pitchPresets'

import { calcPixelsPerCabinet, syncCabinetGridFromMeters } from '../lib/cabinetGrid'

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

  manualMode: boolean

  onManualModeChange: (enabled: boolean) => void

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

}



const CONTROLLERS: ControllerModel[] = [

  'NovaStar VX1000',

  'NovaStar MCTRL4K',

  'Generic 1G Controller',

]



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

  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20'



const readOnlyClass =

  'w-full rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-600'



export default function Sidebar({

  screens,

  activeScreenId,

  config,

  onChange,

  onSelectScreen,

  onAddScreen,

  onRemoveScreen,

  onRenameScreen,

  manualMode,

  onManualModeChange,

  emptyPaintMode,

  onEmptyPaintModeChange,

  gridLayout,

  onGridLayoutChange,

  showCombinedPacking,

  onShowCombinedPackingChange,

  globalTotals,

}: SidebarProps) {

  const update = <K extends keyof ScreenConfig>(key: K, value: ScreenConfig[K]) => {

    onChange(syncCabinetGridFromMeters({ ...config, [key]: value }))

  }



  const updateInt = (key: keyof ScreenConfig, raw: string, min = 1) => {

    const val = Math.max(min, parseInt(raw, 10) || min)

    update(key, val as ScreenConfig[typeof key])

  }



  const updateMeters = (key: 'wallWidthM' | 'wallHeightM', raw: string) => {

    const val = Math.max(0.1, parseFloat(raw) || 0.1)

    onChange(syncCabinetGridFromMeters({ ...config, [key]: val }))

  }



  const isPreset = config.pitchPreset !== 'custom'

  const activePreset = isPreset ? getPitchPreset(config.pitchPreset) : undefined

  const powerLineLimitHint = getPowerLineLimitHint(config)

  const { pixelsWide, pixelsHigh } = calcPixelsPerCabinet(config)



  const handlePresetChange = (presetId: PitchPresetId) => {

    onChange(syncCabinetGridFromMeters(applyPitchPreset(config, presetId)))

  }



  return (

    <aside className="sidebar-print-hide flex h-full w-80 shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white">

      <div className="border-b border-slate-100 px-5 py-4">

        <h1 className="text-lg font-bold text-slate-900">LED Cable Mapper</h1>

        <p className="mt-0.5 text-xs text-slate-500">Video Wall Routing &amp; Billing</p>

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

          <div className="grid grid-cols-2 gap-3">

            <Field label="Wall Width (m)">

              <input

                type="number"

                min={0.1}

                step={0.1}

                className={inputClass}

                value={config.wallWidthM}

                onChange={(e) => updateMeters('wallWidthM', e.target.value)}

              />

            </Field>

            <Field label="Wall Height (m)">

              <input

                type="number"

                min={0.1}

                step={0.1}

                className={inputClass}

                value={config.wallHeightM}

                onChange={(e) => updateMeters('wallHeightM', e.target.value)}

              />

            </Field>

          </div>

          <p className="text-[10px] text-slate-400">

            → {config.cabinetsWide} × {config.cabinetsHigh} cabinets (

            {config.cabinetWidthMm}×{config.cabinetHeightMm} mm)

          </p>

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

              <div className="grid grid-cols-2 gap-3">

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

                    className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${

                      config.customDensityInput === mode

                        ? 'bg-blue-600 text-white shadow-sm'

                        : 'text-slate-600 hover:bg-slate-50'

                    }`}

                  >

                    {mode === 'pitch' ? 'From Pitch' : 'Direct Pixels'}

                  </button>

                ))}

              </div>

              <div className="grid grid-cols-2 gap-3">

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

                <div className="grid grid-cols-2 gap-3">

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



          <div className="grid grid-cols-2 gap-3">

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

              {CONTROLLERS.map((c) => (

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

              className={`relative inline-flex h-7 w-12 items-center rounded-full transition ${

                config.signalBackup ? 'bg-green-500' : 'bg-slate-300'

              }`}

            >

              <span

                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${

                  config.signalBackup ? 'translate-x-6' : 'translate-x-1'

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

                  className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${

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

                className={`relative inline-flex h-7 w-12 items-center rounded-full transition ${

                  emptyPaintMode ? 'bg-green-500' : 'bg-slate-300'

                }`}

              >

                <span

                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${

                    emptyPaintMode ? 'translate-x-6' : 'translate-x-1'

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

                className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${

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

                className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${

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

                  className={`relative inline-flex h-7 w-12 items-center rounded-full transition ${

                    showCombinedPacking ? 'bg-blue-500' : 'bg-slate-300'

                  }`}

                >

                  <span

                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${

                      showCombinedPacking ? 'translate-x-6' : 'translate-x-1'

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

          <Field label="Line Direction / Направление линии">

            <div className="flex rounded-lg border border-slate-200 p-0.5">

              {(['left', 'right'] as ChainStartEdge[]).map((edge) => (

                <button

                  key={edge}

                  type="button"

                  onClick={() => update('chainStartEdge', edge)}

                  className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${

                    config.chainStartEdge === edge

                      ? 'bg-blue-600 text-white shadow-sm'

                      : 'text-slate-600 hover:bg-slate-50'

                  }`}

                >

                  {edge === 'left' ? 'Left → Right / Слева направо' : 'Right → Left / Справа налево'}

                </button>

              ))}

            </div>

            <p className="mt-1 text-[10px] text-slate-500">

              Data и power: один горизонтальный обход в блоке, старт снизу с выбранного края.

            </p>

          </Field>

          <Field label="Manual Routing / Ручная схема">

            <div className="flex items-center">

              <button

                type="button"

                role="switch"

                aria-checked={manualMode}

                onClick={() => onManualModeChange(!manualMode)}

                className={`relative inline-flex h-7 w-12 items-center rounded-full transition ${

                  manualMode ? 'bg-amber-500' : 'bg-slate-300'

                }`}

              >

                <span

                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${

                    manualMode ? 'translate-x-6' : 'translate-x-1'

                  }`}

                />

              </button>

              <span className="ml-2 text-xs text-slate-500">

                {manualMode ? 'Paint / Set Start / Empty on grid' : 'Auto rectangular blocks'}

              </span>

            </div>

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


