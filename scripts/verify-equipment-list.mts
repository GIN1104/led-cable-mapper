/**
 * Проверка автозаполнения листа оборудования: ספיקונים, רובוט, אזיקונים.
 * Запуск: npm run verify:equipment
 */
import type { ScreenConfig } from '../src/types/index.ts'
import { applyPitchPreset } from '../src/lib/pitchPresets.ts'
import { computeRouting } from '../src/lib/routingEngine.ts'
import { syncCabinetGridFromMeters } from '../src/lib/cabinetGrid.ts'
import {
  buildEquipmentListState,
  resolveEquipmentAutoQuantity,
  resolveEquipmentScreenResults,
  resolveCableTiesPacks,
} from '../src/lib/equipmentList.ts'

function makeConfig(
  wallWidthM: number,
  wallHeightM: number,
  id = 'test',
  name = 'Test',
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
  })
  return applyPitchPreset(base, '3.9-big')
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

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\nAll equipment list checks passed.')
