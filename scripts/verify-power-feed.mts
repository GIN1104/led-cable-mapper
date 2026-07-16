/**
 * Проверка powerFeedMode: edge vs center на 10×3 м, 3.9 Big.
 * Center: полоса делится на две односторонние daisy-chain (без ветвления из кубика).
 * Запуск: npm run verify:feed
 */
import type { PowerFeedMode, ScreenConfig } from '../src/types/index.ts'
import { applyPitchPreset } from '../src/lib/pitchPresets.ts'
import { getPowerTrunkCabinet } from '../src/lib/powerRouting.ts'
import { syncCabinetGridFromMeters } from '../src/lib/cabinetGrid.ts'
import { computeRouting } from '../src/lib/routingEngine.ts'
import { buildEquipmentListState } from '../src/lib/equipmentList.ts'

function makeConfig(powerFeedMode: PowerFeedMode): ScreenConfig {
  const base = syncCabinetGridFromMeters({
    id: 'test',
    name: 'Test',
    emptyCabinets: [],
    wallWidthM: 10,
    wallHeightM: 3,
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
    powerFeedMode,
    hangMount: false,
    stripWidths: [],
  })
  return applyPitchPreset(base, '3.9-big')
}

function trunkDestinations(mode: PowerFeedMode): string[] {
  const config = makeConfig(mode)
  const result = computeRouting(config)
  return result.cableSchedule
    .filter((e) => e.cableId.startsWith('M-PWR'))
    .map((e) => e.destination.replace('Test — Cabinet ', ''))
}

const edge = trunkDestinations('edge')
const center = trunkDestinations('center')

console.log('Edge trunk destinations:', edge.join(', '))
console.log('Center trunk destinations:', center.join(', '))

const expectedEdge = ['A1', 'B1', 'C1', 'A11', 'B11', 'C11']

let ok = true
if (JSON.stringify(edge) !== JSON.stringify(expectedEdge)) {
  ok = false
  console.error('Edge mismatch: expected', expectedEdge, 'got', edge)
}
if (JSON.stringify(edge) === JSON.stringify(center)) {
  ok = false
  console.error('Edge and center produce identical trunk destinations')
}
// Center: вдвое больше линий (влево + вправо от центра каждой полосы)
if (center.length !== expectedEdge.length * 2) {
  ok = false
  console.error(
    'Center should split each band into 2 one-way lines:',
    'expected',
    expectedEdge.length * 2,
    'got',
    center.length,
    center,
  )
}

const edgeResult = computeRouting(makeConfig('edge'))
const edgeStarts = edgeResult.powerLines.map((l) => l.cabinets[0]?.label)
console.log('Edge chain starts:', edgeStarts.join(', '))
if (JSON.stringify(edgeStarts) !== JSON.stringify(expectedEdge)) {
  ok = false
  console.error('Edge chain starts mismatch: expected', expectedEdge, 'got', edgeStarts)
}

const config = makeConfig('center')
const result = computeRouting(config)
const centerStarts = result.powerLines.map((l) => l.cabinets[0]?.label)
console.log('Center chain starts:', centerStarts.join(', '))

for (const line of result.powerLines) {
  const feed = getPowerTrunkCabinet(line, 'center')
  const start = line.cabinets[0]
  if (!start || feed.label !== start.label) {
    ok = false
    console.error(
      `P${line.lineNumber}: center feed (${feed.label}) must equal chain start (${start?.label})`,
    )
  }
}

// Нет ветвления: из старта не больше одного исходящего линка
for (const line of result.powerLines) {
  if (line.cabinets.length < 2) continue
  const start = line.cabinets[0].label
  const out = result.powerLinks.filter(
    (l) => l.chainId === line.lineNumber && l.from.label === start,
  )
  if (out.length !== 1) {
    ok = false
    console.error(
      `P${line.lineNumber}: expected exactly 1 outgoing link from ${start} (no branch), got ${out.length}`,
    )
  } else {
    console.log(`P${line.lineNumber}: ${start} → ${out[0]!.to.label}`)
  }
}

const schema = result.routingSchema.join('\n')
if (!schema.includes('center feed') || !schema.includes('32A Robot')) {
  ok = false
  console.error('Routing schema missing center feed / 32A Robot labels')
}

const packing = result.packingList.find((item) => item.item.includes('Power Trunk'))
const outletCount = result.powerLines.length
if (
  !packing?.notes.includes('32A PDU distro') ||
  !packing.notes.includes(`${outletCount} outlet`)
) {
  ok = false
  console.error('Packing list missing center feed distro notes:', packing?.notes)
}

const robotRow = buildEquipmentListState(
  [config],
  [{ screen: config, result }],
  result.cableSchedule,
  result.packingList,
).rows.find((row) => row.id === 'robot-32a')
if (!robotRow?.russian.includes('center feed')) {
  ok = false
  console.error('Equipment robot row missing center feed note:', robotRow?.russian)
}

console.log(ok ? 'PASS' : 'FAIL')
process.exit(ok ? 0 : 1)
