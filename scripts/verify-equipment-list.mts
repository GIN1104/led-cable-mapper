/**
 * Проверка автозаполнения листа оборудования: ספיקונים, רובוט, אזיקונים, CVT, процессор, LED-карта.
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
  resolveCableTiesPacks,
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
  result10x3.summary.powerLines,
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
assertEq(
  'cableTies 10×3',
  resolveCableTiesPacks([screen10x3], equipmentResults),
  1,
)

const state10x3 = buildEquipmentListState(
  [screen10x3],
  equipmentResults,
  result10x3.cableSchedule,
  result10x3.packingList,
)
assertEq('speakon row', qtyById(state10x3, 'speakon'), result10x3.summary.powerLines)
assertEq(
  'robot row',
  qtyById(state10x3, 'robot-32a'),
  Math.max(1, Math.ceil(result10x3.summary.powerLines / 6)),
)
assertEq('cable-ties row', qtyById(state10x3, 'cable-ties'), 1)

// --- 2 экрана → אזיקונים 2 ---
const s1 = makeConfig(10, 3, 's1', 'Screen 1')
const s2 = makeConfig(8, 3, 's2', 'Screen 2')
const r1 = computeRouting(s1)
const r2 = computeRouting(s2)
const multiResults = [
  { screen: s1, result: r1 },
  { screen: s2, result: r2 },
]
console.log('\n=== 2 screens → azikons 2 ===')
assertEq(
  'cableTies 2 screens',
  resolveCableTiesPacks([s1, s2], multiResults),
  2,
)
assertEq(
  'speakons multi',
  resolveEquipmentAutoQuantity('speakons', [s1, s2], multiResults, []),
  r1.summary.powerLines + r2.summary.powerLines,
)

// --- 15×3 один экран → אזיקונים 2 (ширина > 14 м) ---
const screen15x3 = makeConfig(15, 3)
const result15x3 = computeRouting(screen15x3)
const res15 = [{ screen: screen15x3, result: result15x3 }]
console.log('\n=== 15×3m wide single screen → azikons 2 ===')
assertEq('cableTies 15×3', resolveCableTiesPacks([screen15x3], res15), 2)

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

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\nAll equipment list checks passed.')
