/**
 * Проверка автозаполнения листа оборудования: ספיקונים, רובוט, אזיקונים (+), CVT, процессор, LED-карта.
 * Запуск: npm run verify:equipment
 */
import type { ControllerModel, RoutingResult, ScreenConfig } from '../src/types/index.ts'
import { applyPitchPreset } from '../src/lib/pitchPresets.ts'
import { computeRouting } from '../src/lib/routingEngine.ts'
import { syncCabinetGridFromMeters } from '../src/lib/cabinetGrid.ts'
import {
  aggregateCvtOptical,
  aggregateLedCards,
  buildEquipmentListState,
  resolveCvtModel,
  resolveCvtQtyForScreen,
  resolveEquipmentAutoQuantity,
  resolveEquipmentScreenResults,
  roundUpToNext20,
} from '../src/lib/equipmentList.ts'

function makeConfig(
  wallWidthM: number,
  wallHeightM: number,
  id = 'test',
  name = 'Test',
  overrides: Partial<ScreenConfig> = {},
): ScreenConfig {
  const base = syncCabinetGridFromMeters({
    id,
    name,
    emptyCabinets: [],
    wallWidthM,
    wallHeightM,
    cabinetsWide: 0,
    cabinetsHigh: 0,
    cabinetWidthMm: 500,
    cabinetHeightMm: 1000,
    densityMode: 'pitch',
    totalResolutionWidth: 3840,
    totalResolutionHeight: 2160,
    pixelPitchMm: 3.9,
    pitchPreset: '3.9-big',
    customDensityInput: 'pitch',
    customPixelsWide: 128,
    customPixelsHigh: 256,
    maxPowerPerCabinetW: 400,
    avgPowerPerCabinetW: 200,
    controllerModel: 'NovaStar VX1000',
    signalBackup: true,
    trunkLengthM: 15,
    refreshRate: 60,
    chainStartEdge: 'left',
    powerFeedMode: 'edge',
    hangMount: false,
    ...overrides,
  })
  return applyPitchPreset(base, '3.9-big')
}

/** Минимальный RoutingResult с заданным числом data-портов (для CVT-тестов) */
function fakeResult(dataPorts: number): RoutingResult {
  return {
    summary: {
      totalCabinets: 0,
      totalPixels: 0,
      dataPorts,
      backupPorts: 0,
      powerLines: 0,
      maxPixelsPerPort: 0,
      avgLoadPercent: 0,
      maxLoadPercent: 0,
    },
    dataChains: [],
    powerChains: [],
    cableSchedule: [],
    packingList: [],
  } as unknown as RoutingResult
}

function qtyById(
  state: ReturnType<typeof buildEquipmentListState>,
  id: string,
): string {
  return state.rows.find((r) => r.id === id)?.quantity ?? ''
}

let failed = 0

function assertEq(label: string, actual: string | number | undefined, expected: string | number) {
  const a = String(actual ?? '')
  const e = String(expected)
  if (a !== e) {
    console.error(`FAIL ${label}: expected ${e}, got ${a || '(empty)'}`)
    failed++
  } else {
    console.log(`PASS ${label}: ${e}`)
  }
}

// --- 10×3 м: баг с пустым allScreenResults (один экран) ---
const screen10x3 = makeConfig(10, 3)
const result10x3 = computeRouting(screen10x3)
const emptyAllScreens: { screen: ScreenConfig; result: typeof result10x3 }[] = []
const equipmentResults = resolveEquipmentScreenResults(emptyAllScreens, {
  screen: screen10x3,
  result: result10x3,
})

console.log('\n=== 10×3m single screen (empty allScreenResults fallback) ===')
console.log(`powerLines: ${result10x3.summary.powerLines}`)

assertEq(
  'speakons (fallback)',
  resolveEquipmentAutoQuantity(
    'speakons',
    [screen10x3],
    equipmentResults,
    result10x3.cableSchedule,
  ),
  result10x3.summary.powerLines + 2,
)
assertEq(
  'robot32a (fallback)',
  resolveEquipmentAutoQuantity(
    'robot32a',
    [screen10x3],
    equipmentResults,
    result10x3.cableSchedule,
  ),
  Math.max(1, Math.ceil(result10x3.summary.powerLines / 6)),
)

const state10x3 = buildEquipmentListState(
  [screen10x3],
  equipmentResults,
  result10x3.cableSchedule,
  result10x3.packingList,
)
assertEq('speakon row', qtyById(state10x3, 'speakon'), result10x3.summary.powerLines + 2)
assertEq(
  'robot row',
  qtyById(state10x3, 'robot-32a'),
  Math.max(1, Math.ceil(result10x3.summary.powerLines / 6)),
)
assertEq('cable-ties default +', qtyById(state10x3, 'cable-ties'), '+')
assertEq('cable-ties has no autoKey', state10x3.rows.find((r) => r.id === 'cable-ties')?.autoKey ?? '', '')
assertEq('tool-bag default +', qtyById(state10x3, 'tool-bag'), '+')
assertEq('fiber empty without CVT', qtyById(state10x3, 'fiber'), '')

// Refresh keeps "+" when not quantityManual
const state10x3Refresh = buildEquipmentListState(
  [screen10x3],
  equipmentResults,
  result10x3.cableSchedule,
  result10x3.packingList,
  state10x3,
)
assertEq('cable-ties after refresh', qtyById(state10x3Refresh, 'cable-ties'), '+')

// --- 2 экрана: אזיקונים остаётся "+" ---
const s1 = makeConfig(10, 3, 's1', 'Screen 1')
const s2 = makeConfig(8, 3, 's2', 'Screen 2')
const r1 = computeRouting(s1)
const r2 = computeRouting(s2)
const multiResults = [
  { screen: s1, result: r1 },
  { screen: s2, result: r2 },
]
console.log('\n=== 2 screens → azikons stay + ===')
const stateMulti = buildEquipmentListState(
  [s1, s2],
  multiResults,
  [...r1.cableSchedule, ...r2.cableSchedule],
  [...r1.packingList, ...r2.packingList],
)
assertEq('cable-ties 2 screens', qtyById(stateMulti, 'cable-ties'), '+')
assertEq(
  'speakons multi',
  resolveEquipmentAutoQuantity('speakons', [s1, s2], multiResults, []),
  r1.summary.powerLines + r2.summary.powerLines + 2,
)

// --- 15×3: אזיקונים тоже "+" (без автоформулы) ---
const screen15x3 = makeConfig(15, 3)
const result15x3 = computeRouting(screen15x3)
const res15 = [{ screen: screen15x3, result: result15x3 }]
console.log('\n=== 15×3m → azikons + ===')
const state15 = buildEquipmentListState(
  [screen15x3],
  res15,
  result15x3.cableSchedule,
  result15x3.packingList,
)
assertEq('cable-ties 15×3', qtyById(state15, 'cable-ties'), '+')

// --- Процессор: без auto, количество пустое ---
console.log('\n=== Processor: no auto quantity ===')
assertEq('processor row empty', qtyById(state10x3, 'processor'), '')
const processorTemplate = state10x3.rows.find((r) => r.id === 'processor')
assertEq('processor has no autoKey', processorTemplate?.autoKey ?? '', '')

// --- כרטיס לד: имя = Controller Model ---
console.log('\n=== LED card matches Controller Model ===')
assertEq(
  'ledCard russian VX1000',
  aggregateLedCards([screen10x3]).russian,
  'NovaStar VX1000',
)
assertEq('ledCard qty', qtyById(state10x3, 'led-card'), 1)

const mctrlScreen = makeConfig(10, 3, 'mctrl', 'MCTRL', {
  controllerModel: 'NovaStar MCTRL4K' as ControllerModel,
})
assertEq(
  'ledCard russian MCTRL4K',
  aggregateLedCards([mctrlScreen]).russian,
  'NovaStar MCTRL4K',
)

// --- CVT: формулы qty + модель ---
console.log('\n=== CVT optical converter rules ===')
assertEq('CVT qty trunk15 ports4', resolveCvtQtyForScreen(15, 4), 0)
assertEq('CVT qty trunk50 ports4', resolveCvtQtyForScreen(50, 4), 1)
assertEq('CVT qty trunk15 ports8', resolveCvtQtyForScreen(15, 8), 2)
assertEq('CVT qty trunk50 ports8', resolveCvtQtyForScreen(50, 8), 2)
assertEq('CVT model VX1000', resolveCvtModel('NovaStar VX1000'), 'CVT10')
assertEq('CVT model MCTRL4K', resolveCvtModel('NovaStar MCTRL4K'), 'CVT16')

const cvtNone = aggregateCvtOptical([
  { screen: makeConfig(10, 3, 'c1', 'C1', { trunkLengthM: 15 }), result: fakeResult(4) },
])
assertEq('CVT none qty', cvtNone.quantity, 0)

const cvtTrunk = aggregateCvtOptical([
  {
    screen: makeConfig(10, 3, 'c2', 'C2', { trunkLengthM: 50, controllerModel: 'NovaStar VX1000' }),
    result: fakeResult(4),
  },
])
assertEq('CVT trunk50 ×1 model', cvtTrunk.russian, 'CVT10')
assertEq('CVT trunk50 ×1 qty', cvtTrunk.quantity, 1)

const cvtPorts = aggregateCvtOptical([
  {
    screen: makeConfig(10, 3, 'c3', 'C3', { trunkLengthM: 15, controllerModel: 'NovaStar VX1000' }),
    result: fakeResult(8),
  },
])
assertEq('CVT ports8 ×2', cvtPorts.quantity, 2)
assertEq('CVT ports8 model', cvtPorts.russian, 'CVT10')

const cvtMctrlTrunk = aggregateCvtOptical([
  {
    screen: makeConfig(10, 3, 'c4', 'C4', {
      trunkLengthM: 50,
      controllerModel: 'NovaStar MCTRL4K',
    }),
    result: fakeResult(4),
  },
])
assertEq('CVT MCTRL4K trunk → CVT16 ×1', cvtMctrlTrunk.russian, 'CVT16')
assertEq('CVT MCTRL4K trunk qty', cvtMctrlTrunk.quantity, 1)

const cvtMctrlPorts = aggregateCvtOptical([
  {
    screen: makeConfig(10, 3, 'c5', 'C5', {
      trunkLengthM: 15,
      controllerModel: 'NovaStar MCTRL4K',
    }),
    result: fakeResult(8),
  },
])
assertEq('CVT MCTRL4K ports → CVT16 ×2', cvtMctrlPorts.quantity, 2)
assertEq('CVT MCTRL4K ports model', cvtMctrlPorts.russian, 'CVT16')

const stateCvt = buildEquipmentListState(
  [cvtTrunk.quantity ? makeConfig(10, 3, 'c2', 'C2', { trunkLengthM: 50 }) : screen10x3],
  [
    {
      screen: makeConfig(10, 3, 'c2', 'C2', { trunkLengthM: 50, controllerModel: 'NovaStar VX1000' }),
      result: fakeResult(4),
    },
  ],
  [],
  [],
)
assertEq('cvt row qty', qtyById(stateCvt, 'cvt'), 1)
assertEq('fiber row qty = CVT+1', qtyById(stateCvt, 'fiber'), 2)
assertEq(
  'cvt row russian',
  stateCvt.rows.find((r) => r.id === 'cvt')?.russian ?? '',
  'CVT10',
)

assertEq(
  'cvtOptical auto key',
  resolveEquipmentAutoQuantity(
    'cvtOptical',
    [makeConfig(10, 3, 'c2', 'C2', { trunkLengthM: 50 })],
    [
      {
        screen: makeConfig(10, 3, 'c2', 'C2', { trunkLengthM: 50 }),
        result: fakeResult(4),
      },
    ],
    [],
  ),
  1,
)
assertEq(
  'opticCable = CVT+1',
  resolveEquipmentAutoQuantity(
    'opticCable',
    [makeConfig(10, 3, 'c2', 'C2', { trunkLengthM: 50 })],
    [
      {
        screen: makeConfig(10, 3, 'c2', 'C2', { trunkLengthM: 50 }),
        result: fakeResult(4),
      },
    ],
    [],
  ),
  2,
)
assertEq(
  'opticCable empty when no CVT',
  resolveEquipmentAutoQuantity(
    'opticCable',
    [makeConfig(10, 3, 'c1', 'C1', { trunkLengthM: 15 })],
    [
      {
        screen: makeConfig(10, 3, 'c1', 'C1', { trunkLengthM: 15 }),
        result: fakeResult(4),
      },
    ],
    [],
  ),
  '',
)
assertEq(
  'opticCable ports8 → CVT2+1=3',
  resolveEquipmentAutoQuantity(
    'opticCable',
    [makeConfig(10, 3, 'c3', 'C3', { trunkLengthM: 15 })],
    [
      {
        screen: makeConfig(10, 3, 'c3', 'C3', { trunkLengthM: 15 }),
        result: fakeResult(8),
      },
    ],
    [],
  ),
  3,
)

// --- Подвес (hangMount): шпрайцы ↔ подвес/тросы ---
console.log('\n=== Hang mount: sprayers vs hangers / straps ===')
const hangScreen = makeConfig(10, 3, 'hang', 'Hang', { hangMount: true })
const hangScreen7 = makeConfig(7, 3, 'hang7', 'Hang7', { hangMount: true })
const floorScreen = makeConfig(10, 3, 'floor', 'Floor', { hangMount: false })
const hangResult = computeRouting(hangScreen)
const hangResult7 = computeRouting(hangScreen7)
const floorResult = computeRouting(floorScreen)

assertEq(
  'sprayers floor only',
  resolveEquipmentAutoQuantity('sprayers', [floorScreen], [{ screen: floorScreen, result: floorResult }], []),
  Math.ceil(10) + 1,
)
assertEq(
  'sprayers hang → 0/empty',
  resolveEquipmentAutoQuantity('sprayers', [hangScreen], [{ screen: hangScreen, result: hangResult }], []),
  0,
)
assertEq(
  'hangers hang 10m → 10',
  resolveEquipmentAutoQuantity('hangers', [hangScreen], [{ screen: hangScreen, result: hangResult }], []),
  10,
)
assertEq(
  'hangStraps hang 10m → 15',
  resolveEquipmentAutoQuantity('hangStraps', [hangScreen], [{ screen: hangScreen, result: hangResult }], []),
  15,
)
assertEq(
  'hangStraps hang 7m → 11',
  resolveEquipmentAutoQuantity('hangStraps', [hangScreen7], [{ screen: hangScreen7, result: hangResult7 }], []),
  11,
)
assertEq(
  'hangers floor → 0/empty',
  resolveEquipmentAutoQuantity('hangers', [floorScreen], [{ screen: floorScreen, result: floorResult }], []),
  0,
)
assertEq(
  'hangStraps floor → 0/empty',
  resolveEquipmentAutoQuantity('hangStraps', [floorScreen], [{ screen: floorScreen, result: floorResult }], []),
  0,
)

const mixedHangResults = [
  { screen: hangScreen, result: hangResult },
  { screen: floorScreen, result: floorResult },
]
assertEq(
  'mixed: sprayers from floor only',
  resolveEquipmentAutoQuantity('sprayers', [hangScreen, floorScreen], mixedHangResults, []),
  Math.ceil(10) + 1,
)
assertEq(
  'mixed: hangers from hang only',
  resolveEquipmentAutoQuantity('hangers', [hangScreen, floorScreen], mixedHangResults, []),
  10,
)
assertEq(
  'mixed: hangStraps from hang only',
  resolveEquipmentAutoQuantity('hangStraps', [hangScreen, floorScreen], mixedHangResults, []),
  15,
)

const stateHang = buildEquipmentListState(
  [hangScreen],
  [{ screen: hangScreen, result: hangResult }],
  hangResult.cableSchedule,
  hangResult.packingList,
)
assertEq('hang: sprays row empty', qtyById(stateHang, 'sprays'), '')
assertEq('hang: hangers qty', qtyById(stateHang, 'hangers'), 10)
assertEq('hang: rigging-wire qty', qtyById(stateHang, 'rigging-wire'), 15)

const templateOrder = stateHang.rows.map((r) => r.id)
const spraysIdx = templateOrder.indexOf('sprays')
const hangersIdx = templateOrder.indexOf('hangers')
const riggingIdx = templateOrder.indexOf('rigging-wire')
const computerIdx = templateOrder.indexOf('computer')
assertEq('order: sprays before hangers', spraysIdx < hangersIdx ? 1 : 0, 1)
assertEq('order: hangers before rigging', hangersIdx === spraysIdx + 1 ? 1 : 0, 1)
assertEq('order: rigging after hangers', hangersIdx + 1 === riggingIdx ? 1 : 0, 1)
assertEq('order: hang gear before computer', hangersIdx < computerIdx ? 1 : 0, 1)

// --- Тикшорет: округление вверх до 20; Тикшорет Длинный = dataPorts + 2 ---
console.log('\n=== Tikshoret rounding + long row ===')
assertEq('roundUp 0 → 0', roundUpToNext20(0), 0)
assertEq('roundUp 1 → 20', roundUpToNext20(1), 20)
assertEq('roundUp 20 → 20', roundUpToNext20(20), 20)
assertEq('roundUp 21 → 40', roundUpToNext20(21), 40)
assertEq('roundUp 40 → 40', roundUpToNext20(40), 40)

const rawDataCables = result10x3.cableSchedule.filter(
  (e) =>
    (e.lineType === 'Data' || e.lineType === 'Data Backup') &&
    (e.cableId.startsWith('M-') ||
      e.cableId.startsWith('L-DAT-') ||
      e.cableId.startsWith('L-DBK-')),
).length
const expectedTikshoret = roundUpToNext20(rawDataCables)
assertEq(
  'dataCables rounded to 20',
  resolveEquipmentAutoQuantity(
    'dataCables',
    [screen10x3],
    equipmentResults,
    result10x3.cableSchedule,
  ),
  expectedTikshoret,
)
assertEq('comm-cable row rounded', qtyById(state10x3, 'comm-cable'), expectedTikshoret)

const expectedLong = result10x3.summary.dataPorts + 2
assertEq(
  'commCableLong = dataPorts+2',
  resolveEquipmentAutoQuantity(
    'commCableLong',
    [screen10x3],
    equipmentResults,
    result10x3.cableSchedule,
  ),
  expectedLong,
)
assertEq('comm-cable-long row', qtyById(state10x3, 'comm-cable-long'), expectedLong)

const multiDataPorts = r1.summary.dataPorts + r2.summary.dataPorts
assertEq(
  'commCableLong multi screens',
  resolveEquipmentAutoQuantity('commCableLong', [s1, s2], multiResults, []),
  multiDataPorts + 2,
)
assertEq('comm-cable-long multi row', qtyById(stateMulti, 'comm-cable-long'), multiDataPorts + 2)

const commIdx = state10x3.rows.findIndex((r) => r.id === 'comm-cable')
const commLongIdx = state10x3.rows.findIndex((r) => r.id === 'comm-cable-long')
const speakonIdx = state10x3.rows.findIndex((r) => r.id === 'speakon')
assertEq('order: comm before long', commIdx < commLongIdx ? 1 : 0, 1)
assertEq('order: long right after comm', commLongIdx === commIdx + 1 ? 1 : 0, 1)
assertEq('order: long before speakon', commLongIdx + 1 === speakonIdx ? 1 : 0, 1)
assertEq(
  'long hebrew',
  state10x3.rows.find((r) => r.id === 'comm-cable-long')?.hebrew ?? '',
  'תקשורת תארוך',
)
assertEq(
  'long russian',
  state10x3.rows.find((r) => r.id === 'comm-cable-long')?.russian ?? '',
  'Тикшорет Длинный',
)

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\nAll equipment list checks passed.')
