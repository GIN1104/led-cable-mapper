/**
 * Проверка авто-маршрутизации power: 7×3 м и 10×3 м, 3.9 Big, LTR и RTL.
 * Запуск: npm run verify:power
 */
import type { ChainStartEdge, ScreenConfig } from '../src/types/index.ts'
import { applyPitchPreset } from '../src/lib/pitchPresets.ts'
import { buildPowerLines } from '../src/lib/powerRouting.ts'
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

const ok7Ltr = runCase(7, 3, 'left', '7m×3m 3.9 Big LTR', [
  ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10'],
  ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10'],
  ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10'],
  ['A11', 'B11', 'C11', 'C12', 'B12', 'A12'],
  ['A13', 'B13', 'C13', 'C14', 'B14', 'A14'],
])

const ok10Ltr = runCase(10, 3, 'left', '10m×3m 3.9 Big LTR', [
  ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10'],
  ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10'],
  ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10'],
  ['A11', 'A12', 'A13', 'A14', 'A15', 'A16', 'A17', 'A18', 'A19', 'A20'],
  ['B11', 'B12', 'B13', 'B14', 'B15', 'B16', 'B17', 'B18', 'B19', 'B20'],
  ['C11', 'C12', 'C13', 'C14', 'C15', 'C16', 'C17', 'C18', 'C19', 'C20'],
])

const ok7Rtl = runCase(7, 3, 'right', '7m×3m 3.9 Big RTL', [
  ['A14', 'A13', 'A12', 'A11', 'A10', 'A9', 'A8', 'A7', 'A6', 'A5'],
  ['B14', 'B13', 'B12', 'B11', 'B10', 'B9', 'B8', 'B7', 'B6', 'B5'],
  ['C14', 'C13', 'C12', 'C11', 'C10', 'C9', 'C8', 'C7', 'C6', 'C5'],
  ['A4', 'B4', 'C4', 'C3', 'B3', 'A3'],
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

const allOk = ok7Ltr && ok10Ltr && ok7Rtl && ok10Rtl
console.log(`\n${allOk ? 'ALL PASS' : 'SOME FAILED'}`)
process.exit(allOk ? 0 : 1)
