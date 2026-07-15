/**
 * Проверка авто-маршрутизации power: 7×3 м, 10×3 м, 14×8 м, кейс где max(12) лучше.
 * Запуск: npm run verify:power
 */
import type { ChainStartEdge, ScreenConfig } from '../src/types/index.ts'
import { applyPitchPreset } from '../src/lib/pitchPresets.ts'
import {
  buildPowerLines,
  choosePowerPackWidth,
} from '../src/lib/powerRouting.ts'
import {
  getMaxCabinetsPerPowerLine,
  getPreferredCabinetsPerPowerLine,
} from '../src/lib/constants.ts'
import {
  generateCabinetGrid,
  filterActiveCabinets,
  syncCabinetGridFromMeters,
} from '../src/lib/cabinetGrid.ts'

function makeConfig(
  wallWidthM: number,
  wallHeightM: number,
  chainStartEdge: ChainStartEdge = 'left',
): ScreenConfig {
  const base = syncCabinetGridFromMeters({
    id: 'test',
    name: 'Test',
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
    chainStartEdge,
    powerFeedMode: 'edge',
    hangMount: false,
  })
  return applyPitchPreset(base, '3.9-big')
}

function runCase(
  wallWidthM: number,
  wallHeightM: number,
  chainStartEdge: ChainStartEdge,
  label: string,
  expected: string[][],
): boolean {
  const config = makeConfig(wallWidthM, wallHeightM, chainStartEdge)
  const cabs = filterActiveCabinets(generateCabinetGrid(config), new Set())
  const { lines } = buildPowerLines(cabs, config)

  console.log(
    `\n=== ${label} (${config.cabinetsWide}×${config.cabinetsHigh} = ${cabs.length} cabs) ===`,
  )
  console.log('Lines:', lines.length)
  for (const line of lines) {
    console.log(
      `P${line.lineNumber} (${line.cabinets.length}):`,
      line.cabinets.map((c) => c.label).join(' -> '),
    )
  }

  let ok = lines.length === expected.length
  if (lines[0]?.cabinets[0]?.label !== expected[0]?.[0]) {
    ok = false
    console.error(
      `P1 start: expected ${expected[0]?.[0]}, got ${lines[0]?.cabinets[0]?.label}`,
    )
  }
  for (let i = 0; i < expected.length; i++) {
    const labels = lines[i]?.cabinets.map((c) => c.label) ?? []
    if (JSON.stringify(labels) !== JSON.stringify(expected[i])) {
      ok = false
      console.error(
        `Mismatch P${i + 1}: expected ${expected[i].join('->')}, got ${labels.join('->')}`,
      )
    }
  }
  console.log(ok ? 'PASS' : 'FAIL')
  return ok
}

function assertPackWidth(
  cols: number,
  rows: number,
  preferred: number,
  max: number,
  expected: number,
  label: string,
): boolean {
  const got = choosePowerPackWidth(cols, rows, preferred, max)
  const ok = got === expected
  console.log(
    `\n=== packWidth ${label}: ${cols}×${rows} pref=${preferred} max=${max} → ${got} (expect ${expected}) ===`,
  )
  console.log(ok ? 'PASS' : 'FAIL')
  return ok
}

function rowLetters(high: number): string[] {
  // A = низ, далее вверх: A,B,C,... для high рядов
  return Array.from({ length: high }, (_, i) => String.fromCharCode(65 + i))
}

/** Горизонтальная полоса ряда letter, столбцы fromCol..toCol включительно */
function horizStrip(
  letter: string,
  fromCol: number,
  toCol: number,
  rtl = false,
): string[] {
  const cols: number[] = []
  if (rtl) {
    for (let c = toCol; c >= fromCol; c--) cols.push(c)
  } else {
    for (let c = fromCol; c <= toCol; c++) cols.push(c)
  }
  return cols.map((c) => `${letter}${c}`)
}

/** Вертикаль снизу вверх в столбце col по буквам A.. */
function vertCol(col: number, letters: string[]): string[] {
  return letters.map((letter) => `${letter}${col}`)
}

// 7m×3m = 14×3: ширина не делится на 10 → pack 12; остаток 2 кол. — P-паттерн
const ok7Ltr = runCase(7, 3, 'left', '7m×3m 3.9 Big LTR', [
  ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12'],
  ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11', 'B12'],
  ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12'],
  ['A13', 'B13', 'C13', 'C14', 'B14', 'A14'],
])

// 10m×3m = 20×3: две полосы по 10, 6 полных линий → preferred 10
const ok10Ltr = runCase(10, 3, 'left', '10m×3m 3.9 Big LTR', [
  ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10'],
  ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10'],
  ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10'],
  ['A11', 'A12', 'A13', 'A14', 'A15', 'A16', 'A17', 'A18', 'A19', 'A20'],
  ['B11', 'B12', 'B13', 'B14', 'B15', 'B16', 'B17', 'B18', 'B19', 'B20'],
  ['C11', 'C12', 'C13', 'C14', 'C15', 'C16', 'C17', 'C18', 'C19', 'C20'],
])

const ok7Rtl = runCase(7, 3, 'right', '7m×3m 3.9 Big RTL', [
  ['A14', 'A13', 'A12', 'A11', 'A10', 'A9', 'A8', 'A7', 'A6', 'A5', 'A4', 'A3'],
  ['B14', 'B13', 'B12', 'B11', 'B10', 'B9', 'B8', 'B7', 'B6', 'B5', 'B4', 'B3'],
  ['C14', 'C13', 'C12', 'C11', 'C10', 'C9', 'C8', 'C7', 'C6', 'C5', 'C4', 'C3'],
  ['A2', 'B2', 'C2', 'C1', 'B1', 'A1'],
])

const ok10Rtl = runCase(10, 3, 'right', '10m×3m 3.9 Big RTL', [
  ['A20', 'A19', 'A18', 'A17', 'A16', 'A15', 'A14', 'A13', 'A12', 'A11'],
  ['B20', 'B19', 'B18', 'B17', 'B16', 'B15', 'B14', 'B13', 'B12', 'B11'],
  ['C20', 'C19', 'C18', 'C17', 'C16', 'C15', 'C14', 'C13', 'C12', 'C11'],
  ['A10', 'A9', 'A8', 'A7', 'A6', 'A5', 'A4', 'A3', 'A2', 'A1'],
  ['B10', 'B9', 'B8', 'B7', 'B6', 'B5', 'B4', 'B3', 'B2', 'B1'],
  ['C10', 'C9', 'C8', 'C7', 'C6', 'C5', 'C4', 'C3', 'C2', 'C1'],
])

/*
 * Кейс «12 лучше 10»: 6m×3m = 12×3.
 * preferred 10 → полоса 10 + остаток 2 → 3×10 + 1×P(6) = 4 линии.
 * max 12 → одна полоса 12 → 3 полные линии по 12 (меньше линий, без остатка).
 */
const ok6Ltr = runCase(6, 3, 'left', '6m×3m 3.9 Big LTR (12 better than 10)', [
  ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12'],
  ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11', 'B12'],
  ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12'],
])

/*
 * 14m×8m = 28×8: pack 12 → две полосы 12 + остаток 4×8.
 * Остаток: 4 одинаковые вертикали по 8 (не 12+4+12+4).
 */
const letters8 = rowLetters(8)
const expected14x8: string[][] = [
  ...letters8.map((L) => horizStrip(L, 1, 12)),
  ...letters8.map((L) => horizStrip(L, 13, 24)),
  ...[25, 26, 27, 28].map((col) => vertCol(col, letters8)),
]
const ok14x8 = runCase(
  14,
  8,
  'left',
  '14m×8m 3.9 Big LTR (equal vertical remainder)',
  expected14x8,
)

const configBig = makeConfig(10, 3)
const pref = getPreferredCabinetsPerPowerLine(configBig)
const max = getMaxCabinetsPerPowerLine(configBig)

const okDecisions =
  assertPackWidth(20, 3, pref, max, 10, '10m×3m clean ≤6 → preferred') &&
  assertPackWidth(14, 3, pref, max, 12, '7m×3m rem → max') &&
  assertPackWidth(12, 3, pref, max, 12, '6m×3m clean-at-max → max') &&
  assertPackWidth(20, 4, pref, max, 12, '10m×4m preferred would be 8 lines → max') &&
  assertPackWidth(28, 8, pref, max, 12, '14m×8m rem → max')

const allOk =
  ok7Ltr && ok10Ltr && ok7Rtl && ok10Rtl && ok6Ltr && ok14x8 && okDecisions
console.log(`\n${allOk ? 'ALL PASS' : 'SOME FAILED'}`)
process.exit(allOk ? 0 : 1)
