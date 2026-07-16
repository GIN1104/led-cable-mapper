/** Модели контроллеров LED-стен */

import { syncCabinetGridFromMeters } from '../lib/cabinetGrid'

export type ControllerModel =
  | 'TB60'
  | 'NovaStar VX1000'
  | 'NovaStar VX2000'
  | 'NovaStar 600'
  | 'NovaStar H2'
  | 'NovaStar MCTRL4K'
  | 'Linsn'
  | 'Generic 1G Controller'

/** Все модели контроллеров — единый список для UI */
export const CONTROLLER_MODELS: ControllerModel[] = [
  'TB60',
  'NovaStar VX1000',
  'NovaStar VX2000',
  'NovaStar 600',
  'NovaStar H2',
  'NovaStar MCTRL4K',
  'Linsn',
  'Generic 1G Controller',
]



/** Длина магистрального кабеля до машинного отделения */

export type TrunkLengthM = 15 | 30 | 50



/** Частота обновления экрана (Гц) — влияет на лимит пикселей на data-порт */

export type RefreshRate = 50 | 60



/** Расположение панелей визуализации сетки */

export type GridLayout = 'side-by-side' | 'stacked'



/** Горизонтальное направление обхода линии внутри блока */

export type LineDirection = 'ltr' | 'rtl'

/**
 * Край старта цепочек: нижний правый (RTL) или нижний левый (LTR).
 * Тикшорет (auto data) всегда идёт справа налево; power использует этот параметр.
 */

export type ChainStartEdge = 'left' | 'right'

/** Точка подвода силового trunk: край первого кабинета или центр полосы */
export type PowerFeedMode = 'edge' | 'center'



/** Режим задания плотности пикселей */

export type DensityMode = 'resolution' | 'pitch'



/** Пресет шага пикселя */

export type PitchPresetId =

  | '3.9-big'

  | '3.9-small'

  | '3.9-reshet'

  | '2.9'

  | 'custom'



/** Способ задания пикселей в режиме Custom */

export type CustomDensityInput = 'pitch' | 'pixels'



/** Уникальный идентификатор экрана */

export type ScreenId = string



/** Конфигурация одного экрана — ввод пользователя */

export interface ScreenConfig {

  id: ScreenId

  name: string

  /** Метки пропущенных ячеек (A1, B2…) — не участвуют в маршрутизации */

  emptyCabinets: string[]

  /** Физическая ширина стены в метрах (ввод пользователя) */
  wallWidthM: number

  /** Физическая высота стены в метрах (ввод пользователя) */
  wallHeightM: number

  /** Количество кабинетов по ширине — вычисляется из wallWidthM */
  cabinetsWide: number

  /** Количество кабинетов по высоте — вычисляется из wallHeightM */
  cabinetsHigh: number

  cabinetWidthMm: number

  cabinetHeightMm: number

  densityMode: DensityMode

  /** Общее разрешение (если densityMode === 'resolution') */

  totalResolutionWidth: number

  totalResolutionHeight: number

  /** Шаг пикселя в мм (если densityMode === 'pitch') */

  pixelPitchMm: number

  /** Выбранный пресет шага пикселя */

  pitchPreset: PitchPresetId

  /** В custom: задавать пиксели через pitch или напрямую */

  customDensityInput: CustomDensityInput

  /** Пиксели на кабинет (custom + customDensityInput === 'pixels') */

  customPixelsWide: number

  customPixelsHigh: number

  maxPowerPerCabinetW: number

  avgPowerPerCabinetW: number

  controllerModel: ControllerModel

  signalBackup: boolean

  trunkLengthM: TrunkLengthM

  /** Частота обновления — лимит пикселей на 1G data-порт */

  refreshRate: RefreshRate

  /** Направление линии (LTR/RTL) и край старта при авто-разбиении */

  chainStartEdge: ChainStartEdge

  /** Подвод power trunk: с края линии или в центр полосы */

  powerFeedMode: PowerFeedMode

  /**
   * Подвес (Hang / תלייה): вместо шпрайцев — тросы/подвесы
   * по метрам ширины стены (1 м → 1 подвес). По умолчанию выкл.
   */
  hangMount: boolean

  /**
   * Вертикальные полосы (группы колонок). Ширины в кабинетах; сумма = cabinetsWide.
   * Одна полоса [cabinetsWide] — без зазоров (поведение по умолчанию).
   * Каждая полоса — отдельный блок для auto data и power (линии не переходят через зазор).
   */
  stripWidths: number[]

  /**
   * Два NovaStar VX1000: стрипы делятся между контроллерами.
   * Нумерация линий вида 1-1, 2-1 (контроллер-линия).
   */
  dualVx1000: boolean

  /**
   * Какой VX1000 обслуживает стрип (1 или 2). Длина = число полос.
   * Имеет смысл при dualVx1000 && stripWidths.length > 1.
   */
  stripControllerIds: number[]

}



/** Одна LED-кабинетка на сетке */

export interface Cabinet {

  id: string

  label: string

  row: number

  col: number

  rowLetter: string

  pixelsWide: number

  pixelsHigh: number

  totalPixels: number

  maxPowerW: number

}



/** Цепочка данных (один порт контроллера) */

export interface DataChain {

  portNumber: number

  cabinets: Cabinet[]

  totalPixels: number

  isBackup: boolean

  /** Порт основной цепочки, для которого это резерв */

  backupForPort?: number

  /** При dual VX1000: номер контроллера (1|2) */
  controllerId?: number

  /** Номер линии внутри контроллера */
  localNumber?: number

  /** Подпись для UI: «1-1», «2-3»; если нет — portNumber */
  displayId?: string

}



/** Линия питания */

export interface PowerLine {

  lineNumber: number

  cabinets: Cabinet[]

  totalPowerW: number

  controllerId?: number

  localNumber?: number

  displayId?: string

}



/** Запись в таблице кабельной ведомости */

export interface CableScheduleEntry {

  cableId: string

  lineType: 'Data' | 'Data Backup' | 'Power'

  source: string

  destination: string

  cableType: string

  lengthM: number

  quantity: number

  colorAdvice: string

  /** Имя экрана (для мультиэкранных проектов) */

  screenName?: string

}



/** Позиция в упаковочном листе */

export interface PackingListItem {

  item: string

  quantity: number

  notes: string

}



/** Направление связи между соседними кабинетами */

export interface GridLink {

  from: Cabinet

  to: Cabinet

  type: 'data' | 'data-backup' | 'power'

  chainId: number

  direction: 'horizontal' | 'vertical'

}



/** Полный результат расчёта маршрутизации */

export interface RoutingResult {

  cabinets: Cabinet[]

  dataChains: DataChain[]

  backupChains: DataChain[]

  powerLines: PowerLine[]

  dataLinks: GridLink[]

  backupLinks: GridLink[]

  powerLinks: GridLink[]

  routingSchema: string[]

  cableSchedule: CableScheduleEntry[]

  packingList: PackingListItem[]

  summary: {

    totalCabinets: number

    totalPixels: number

    dataPorts: number

    backupPorts: number

    powerLines: number

    pixelsPerCabinet: number

    cabinetsPerPowerLine: number

    emptyCabinets: number

  }

  /** Предупреждения при ручной схеме (превышение лимитов) */

  warnings: RoutingValidationWarning[]

}



/** Ручные переопределения назначений кабинетов */

export interface ManualRoutingOverrides {

  /** Метка кабинета → номер data-порта */

  dataPorts: Record<string, number>

  /** Метка кабинета → номер линии питания */

  powerLines: Record<string, number>

  /** Номер data-порта → метка кабинета-старта цепочки */

  dataStartPoints?: Record<number, string>

  /** Номер линии питания → метка кабинета-старта */

  powerStartPoints?: Record<number, string>

  /**
   * Упорядоченные метки кабинетов по data-порту (порядок кликов Paint).
   * Если задано — определяет направление стрелок вместо змейки.
   */
  dataPortChains?: Record<number, string[]>

  /**
   * Упорядоченные метки кабинетов по power-линии (порядок кликов Paint).
   * Если задано — определяет направление стрелок вместо авто-упорядочивания.
   */
  powerLineChains?: Record<number, string[]>

}



/** Предупреждение валидации маршрутизации */

export interface RoutingValidationWarning {

  type: 'data' | 'power'

  id: number

  message: string

}



/** Опции расчёта маршрутизации */

export interface RoutingOptions {

  /** Ручная схема data-портов независима от power */

  manualModeData?: boolean

  /** Ручная схема power-линий независима от data */

  manualModePower?: boolean

  manualOverrides?: ManualRoutingOverrides

}



/** Поля конфигурации без id/name/emptyCabinets */

const DEFAULT_SCREEN_FIELDS: Omit<ScreenConfig, 'id' | 'name' | 'emptyCabinets'> = {

  wallWidthM: 3.0,

  wallHeightM: 2.0,

  cabinetsWide: 6,

  cabinetsHigh: 4,

  cabinetWidthMm: 500,

  cabinetHeightMm: 500,

  densityMode: 'pitch',

  totalResolutionWidth: 3840,

  totalResolutionHeight: 2160,

  pixelPitchMm: 3.9,

  pitchPreset: '3.9-small',

  customDensityInput: 'pitch',

  customPixelsWide: 128,

  customPixelsHigh: 128,

  maxPowerPerCabinetW: 400,

  avgPowerPerCabinetW: 200,

  controllerModel: 'NovaStar VX1000',

  signalBackup: true,

  trunkLengthM: 50,

  refreshRate: 50,

  /** Тикшорет по умолчанию: линии справа налево */
  chainStartEdge: 'right',

  powerFeedMode: 'edge',

  hangMount: false,

  stripWidths: [6],

  dualVx1000: false,

  stripControllerIds: [1],

}



/** Создаёт новый экран с уникальным id */

export function createScreen(

  partial?: Partial<ScreenConfig> & { name?: string },

): ScreenConfig {

  const id =

    partial?.id ??

    (typeof crypto !== 'undefined' && crypto.randomUUID

      ? crypto.randomUUID()

      : `screen-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`)

  const index = partial?.name?.match(/\d+/)?.[0]

  const base: ScreenConfig = {

    ...DEFAULT_SCREEN_FIELDS,

    ...partial,

    id,

    name: partial?.name ?? `Screen ${index ?? 1}`,

    emptyCabinets: partial?.emptyCabinets ?? [],

    // Обратная совместимость: старые конфиги без dual-полей
    dualVx1000: partial?.dualVx1000 ?? DEFAULT_SCREEN_FIELDS.dualVx1000,

    stripControllerIds:
      partial?.stripControllerIds ?? DEFAULT_SCREEN_FIELDS.stripControllerIds,

  }

  // Обратная совместимость: если задано количество кабинетов, но не метры — вычислить метры
  if (partial?.wallWidthM === undefined && partial?.cabinetsWide !== undefined) {
    base.wallWidthM = (base.cabinetsWide * base.cabinetWidthMm) / 1000
  }
  if (partial?.wallHeightM === undefined && partial?.cabinetsHigh !== undefined) {
    base.wallHeightM = (base.cabinetsHigh * base.cabinetHeightMm) / 1000
  }

  return syncCabinetGridFromMeters(base)

}



/** Значения по умолчанию для формы (один экран) */

export const DEFAULT_CONFIG: ScreenConfig = createScreen({ name: 'Screen 1' })



/** Состояние проекта с несколькими экранами */

export interface ProjectState {

  screens: ScreenConfig[]

  activeScreenId: ScreenId

}



export const DEFAULT_PROJECT: ProjectState = {

  screens: [DEFAULT_CONFIG],

  activeScreenId: DEFAULT_CONFIG.id,

}



/** Ручные настройки и режим — отдельно для каждого экрана */

export interface ScreenRoutingState {

  manualModeData: boolean

  manualModePower: boolean

  manualOverrides: ManualRoutingOverrides

}



export const EMPTY_MANUAL_OVERRIDES: ManualRoutingOverrides = {

  dataPorts: {},

  powerLines: {},

  dataStartPoints: {},

  powerStartPoints: {},

  dataPortChains: {},

  powerLineChains: {},

}



export const EMPTY_SCREEN_ROUTING: ScreenRoutingState = {

  manualModeData: false,

  manualModePower: false,

  manualOverrides: EMPTY_MANUAL_OVERRIDES,

}


