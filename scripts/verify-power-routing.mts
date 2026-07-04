/**
 * Проверка авто-маршрутизации power для 7×3 м, 3.9 Big.
 * Запуск: node --experimental-strip-types scripts/verify-power-routing.mts
 */
import type { ScreenConfig } from '../src/types/index.ts'
import { applyPitchPreset } from '../src/lib/pitchPresets.ts'
import { buildPowerLines } from '../src/lib/powerRouting.ts'
import { generateCabinetGrid, filterActiveCabinets, syncCabinetGridFromMeters } from '../src/lib/cabinetGrid.ts'

const base: ScreenConfig = syncCabinetGridFromMeters({
  id: 'test',
  name: 'Test',
  emptyCabinets: [],
  wallWidthM: 7,
  wallHeightM: 3,
  cabinetsWide: 14,
  cabinetsHigh: 3,
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
})

const config = applyPitchPreset(base, '3.9-big')
const cabs = filterActiveCabinets(generateCabinetGrid(config), new Set())
const { lines } = buildPowerLines(cabs, config)

console.log('Grid:', config.cabinetsWide, 'x', config.cabinetsHigh, '=', cabs.length)
console.log('Lines:', lines.length)
for (const line of lines) {
  console.log(
    `P${line.lineNumber} (${line.cabinets.length}):`,
    line.cabinets.map((c) => c.label).join(' -> '),
  )
}

const expected = [
  ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10'],
  ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10'],
  ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10'],
  ['C11', 'B11', 'A11', 'A12', 'B12', 'C12'],
  ['C13', 'B13', 'A13', 'A14', 'B14', 'C14'],
]
let ok = lines.length === 5
for (let i = 0; i < expected.length; i++) {
  const labels = lines[i]?.cabinets.map((c) => c.label) ?? []
  if (JSON.stringify(labels) !== JSON.stringify(expected[i])) {
    ok = false
    console.error(`Mismatch P${i + 1}: expected ${expected[i].join('->')}, got ${labels.join('->')}`)
  }
}
console.log(ok ? 'PASS' : 'FAIL')
process.exit(ok ? 0 : 1)
