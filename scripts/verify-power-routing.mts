/**
 * Проверка авто-маршрутизации power: 3×2 м (1 линия), 7×3 м, 10×3 м, 14×8 м,
 * кейс где max(12) лучше; 6×3.5 м 3.9 Small (4 линии, multi-row);
 * 2.9 — упаковка целыми столбцами без mid-column split.
 * Запуск: npm run verify:power
 */
import type { ChainStartEdge, PitchPresetId, ScreenConfig } from '../src/types/index.ts'
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
  preset: PitchPresetId = '3.9-big',
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
    pitchPreset: preset,
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
    stripWidths: [],
  })
  // Как в UI: после пресета пересчитываем сетку из метров (2.9 = 500×500)
  return syncCabinetGridFromMeters(applyPitchPreset(base, preset))
}

function runCase(
  wallWidthM: number,
  wallHeightM: number,
  chainStartEdge: ChainStartEdge,
  label: string,
  expected: string[][],
  preset: PitchPresetId = '3.9-big',
): boolean {
  const config = makeConfig(wallWidthM, wallHeightM, chainStartEdge, preset)
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

/**
 * Проверяет, что при высоте ≤ max линии 2.9 не режут столбцы посередине:
 * каждый столбец стены целиком принадлежит одной линии; столбцы линии смежны.
 */
function assertNoMidColumnSplits(
  wallWidthM: number,
  wallHeightM: number,
  chainStartEdge: ChainStartEdge,
  label: string,
): boolean {
  const config = makeConfig(wallWidthM, wallHeightM, chainStartEdge, '2.9')
  const cabs = filterActiveCabinets(generateCabinetGrid(config), new Set())
  const { lines } = buildPowerLines(cabs, config)
  const maxSize = getMaxCabinetsPerPowerLine(config)
  const high = config.cabinetsHigh

  console.log(
    `\n=== ${label} (${config.cabinetsWide}×${high} = ${cabs.length} cabs, max ${maxSize}) ===`,
  )
  for (const line of lines) {
    console.log(
      `P${line.lineNumber} (${line.cabinets.length}):`,
      line.cabinets.map((c) => c.label).join(' -> '),
    )
  }

  let ok = true
  if (high > maxSize) {
    console.log('SKIP mid-column rule (height > max)')
    console.log('PASS')
    return true
  }

  const colOwner = new Map<number, number>()
  for (const line of lines) {
    if (line.cabinets.length > maxSize) {
      ok = false
      console.error(`P${line.lineNumber}: ${line.cabinets.length} > max ${maxSize}`)
    }
    const colsInLine = new Map<number, number>()
    for (const cab of line.cabinets) {
      colsInLine.set(cab.col, (colsInLine.get(cab.col) ?? 0) + 1)
    }
    const sortedCols = [...colsInLine.keys()].sort((a, b) => a - b)
    for (let i = 1; i < sortedCols.length; i++) {
      if (sortedCols[i] !== sortedCols[i - 1] + 1) {
        ok = false
        console.error(
          `P${line.lineNumber}: non-contiguous columns ${sortedCols.join(',')}`,
        )
      }
    }
    for (const [col, count] of colsInLine) {
      if (count !== high) {
        ok = false
        console.error(
          `P${line.lineNumber}: mid-column split at col ${col} (${count}/${high})`,
        )
      }
      const prev = colOwner.get(col)
      if (prev != null && prev !== line.lineNumber) {
        ok = false
        console.error(
          `col ${col} split across P${prev} and P${line.lineNumber}`,
        )
      }
      colOwner.set(col, line.lineNumber)
    }
  }

  // Полное покрытие: каждый столбец стены ровно в одной линии
  for (let col = 0; col < config.cabinetsWide; col++) {
    if (!colOwner.has(col)) {
      ok = false
      console.error(`col ${col} missing from all lines`)
    }
  }

  console.log(ok ? 'PASS' : 'FAIL')
  return ok
}

/** Вертикальная змейка по столбцам fromCol..toCol (1-based), letters снизу вверх */
function vertSnakeCols(
  fromCol: number,
  toCol: number,
  letters: string[],
  rtl = false,
): string[] {
  const cols: number[] = []
  if (rtl) {
    for (let c = toCol; c >= fromCol; c--) cols.push(c)
  } else {
    for (let c = fromCol; c <= toCol; c++) cols.push(c)
  }
  const out: string[] = []
  for (let i = 0; i < cols.length; i++) {
    const col = cols[i]
    const goUp = i % 2 === 0
    const seq = goUp ? letters : [...letters].reverse()
    for (const L of seq) out.push(`${L}${col}`)
  }
  return out
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

/**
 * Змейка по нескольким рядам (letters снизу вверх), столбцы fromCol..toCol.
 * startRight=false → нижний ряд LTR, следующий RTL.
 */
function horizSnakeRows(
  lettersBottomToTop: string[],
  fromCol: number,
  toCol: number,
  startRight = false,
): string[] {
  const out: string[] = []
  for (let i = 0; i < lettersBottomToTop.length; i++) {
    const letter = lettersBottomToTop[i]
    const ltr = i % 2 === 0 ? !startRight : startRight
    out.push(...horizStrip(letter, fromCol, toCol, !ltr))
  }
  return out
}

/** Вертикаль снизу вверх в столбце col по буквам A.. */
function vertCol(col: number, letters: string[]): string[] {
  return letters.map((letter) => `${letter}${col}`)
}

/*
 * 3m×2m = 6×2 = 12 cabs ≤ max 12 → одна силовая линия (змейка снизу вверх).
 * Без раннего выхода полосы дали бы 2 ряда × 6.
 */
const ok3x2Ltr = runCase(3, 2, 'left', '3m×2m 3.9 Big LTR (single line ≤ max)', [
  ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'B6', 'B5', 'B4', 'B3', 'B2', 'B1'],
])

const ok3x2Rtl = runCase(3, 2, 'right', '3m×2m 3.9 Big RTL (single line ≤ max)', [
  ['A6', 'A5', 'A4', 'A3', 'A2', 'A1', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6'],
])

// 10m×3m = 20×3: теор. min ceil(60/12)=5; остаток змейкой
const ok10Ltr = runCase(10, 3, 'left', '10m×3m 3.9 Big LTR (min 5 lines)', [
  ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12'],
  ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11', 'B12'],
  ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12'],
  [
    'A13', 'A14', 'A15', 'A16',
    'B16', 'B15', 'B14', 'B13',
    'C13', 'C14', 'C15', 'C16',
  ],
  [
    'A17', 'A18', 'A19', 'A20',
    'B20', 'B19', 'B18', 'B17',
    'C17', 'C18', 'C19', 'C20',
  ],
])

const ok7Ltr = runCase(7, 3, 'left', '7m×3m 3.9 Big LTR (min 4 lines)', [
  ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10'],
  ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10'],
  ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10'],
  [
    'A11', 'A12', 'A13', 'A14',
    'B14', 'B13', 'B12', 'B11',
    'C11', 'C12', 'C13', 'C14',
  ],
])

const ok7Rtl = runCase(7, 3, 'right', '7m×3m 3.9 Big RTL (min 4 lines)', [
  ['A14', 'A13', 'A12', 'A11', 'A10', 'A9', 'A8', 'A7', 'A6', 'A5'],
  ['B14', 'B13', 'B12', 'B11', 'B10', 'B9', 'B8', 'B7', 'B6', 'B5'],
  ['C14', 'C13', 'C12', 'C11', 'C10', 'C9', 'C8', 'C7', 'C6', 'C5'],
  [
    'A4', 'A3', 'A2', 'A1',
    'B1', 'B2', 'B3', 'B4',
    'C4', 'C3', 'C2', 'C1',
  ],
])

const ok10Rtl = runCase(10, 3, 'right', '10m×3m 3.9 Big RTL (min 5 lines)', [
  ['A20', 'A19', 'A18', 'A17', 'A16', 'A15', 'A14', 'A13', 'A12', 'A11', 'A10', 'A9'],
  ['B20', 'B19', 'B18', 'B17', 'B16', 'B15', 'B14', 'B13', 'B12', 'B11', 'B10', 'B9'],
  ['C20', 'C19', 'C18', 'C17', 'C16', 'C15', 'C14', 'C13', 'C12', 'C11', 'C10', 'C9'],
  [
    'A8', 'A7', 'A6', 'A5',
    'B5', 'B6', 'B7', 'B8',
    'C8', 'C7', 'C6', 'C5',
  ],
  [
    'A4', 'A3', 'A2', 'A1',
    'B1', 'B2', 'B3', 'B4',
    'C4', 'C3', 'C2', 'C1',
  ],
])

const ok6Ltr = runCase(6, 3, 'left', '6m×3m 3.9 Big LTR (12 better than 10)', [
  ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12'],
  ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11', 'B12'],
  ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12'],
])

/*
 * 6m×3.5m 3.9 Small: 12×7 = 84 cab, max 24 → теор. min 4.
 * Упаковка по 3 столбца (21) — 4 равные линии, змейка по рядам.
 */
const ok6x35Small = runCase(
  6,
  3.5,
  'left',
  '6m×3.5m 3.9 Small LTR (min 4 equal packs)',
  [
    horizSnakeRows(rowLetters(7), 1, 3),
    horizSnakeRows(rowLetters(7), 4, 6),
    horizSnakeRows(rowLetters(7), 7, 9),
    horizSnakeRows(rowLetters(7), 10, 12),
  ],
  '3.9-small',
)

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
  assertPackWidth(20, 3, pref, max, 12, '10m×3m → max (min lines est.)') &&
  assertPackWidth(14, 3, pref, max, 12, '7m×3m → max') &&
  assertPackWidth(12, 3, pref, max, 12, '6m×3m clean-at-max → max') &&
  assertPackWidth(20, 4, pref, max, 12, '10m×4m → max') &&
  assertPackWidth(28, 8, pref, max, 12, '14m×8m → max')

/*
 * 2.9: 5m×4m = 10×8, max 40 → 2 линии по 5 полных столбцов (40), без mid-column.
 * Порядок — вертикальная змейка (короткие кабели между столбцами).
 */
const letters8_29 = rowLetters(8)
const ok29_5x4 = runCase(
  5,
  4,
  'left',
  '5m×4m 2.9 LTR (full columns×5)',
  [
    vertSnakeCols(1, 5, letters8_29),
    vertSnakeCols(6, 10, letters8_29),
  ],
  '2.9',
)

/*
 * 2.9: 6m×3m = 12×6; 40 не делится на 6 → по floor(40/6)=6 столбцов (36),
 * не 40 с разрезом посередине 7-го столбца.
 */
const ok29_noMid = assertNoMidColumnSplits(
  6,
  3,
  'left',
  '6m×3m 2.9 LTR (no mid-column splits)',
)

const ok29_10x5 = assertNoMidColumnSplits(
  10,
  5,
  'left',
  '10m×5m 2.9 LTR (no mid-column splits)',
)

const allOk =
  ok3x2Ltr &&
  ok3x2Rtl &&
  ok7Ltr &&
  ok10Ltr &&
  ok7Rtl &&
  ok10Rtl &&
  ok6Ltr &&
  ok6x35Small &&
  ok14x8 &&
  okDecisions &&
  ok29_5x4 &&
  ok29_noMid &&
  ok29_10x5
console.log(`\n${allOk ? 'ALL PASS' : 'SOME FAILED'}`)
process.exit(allOk ? 0 : 1)
