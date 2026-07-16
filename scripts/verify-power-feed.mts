/**
 * Проверка powerFeedMode: edge vs center на 10×3 м, 3.9 Big.
 * Center: из центра экрана — линия влево и линия вправо (без ветвления).
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

const edgeConfig = makeConfig('edge')
const centerConfig = makeConfig('center')
const edgeResult = computeRouting(edgeConfig)
const centerResult = computeRouting(centerConfig)

console.log(
  'Grid:',
  edgeConfig.cabinetsWide,
  '×',
  edgeConfig.cabinetsHigh,
  'max/line',
  12,
)
console.log('Edge lines:', edgeResult.powerLines.length)
console.log(
  'Edge starts:',
  edgeResult.powerLines.map((l) => l.cabinets[0]?.label).join(', '),
)
console.log('Center lines:', centerResult.powerLines.length)
console.log(
  'Center starts:',
  centerResult.powerLines.map((l) => l.cabinets[0]?.label).join(', '),
)

let ok = true

// Edge: линии на максимальную длину (≤12), без ветвления
for (const line of edgeResult.powerLines) {
  if (line.cabinets.length < 2) continue
  const start = line.cabinets[0]!.label
  const out = edgeResult.powerLinks.filter(
    (l) => l.chainId === line.lineNumber && l.from.label === start,
  )
  if (out.length !== 1) {
    ok = false
    console.error(`Edge P${line.lineNumber}: expected 1 out from ${start}, got ${out.length}`)
  }
}

// Center: больше линий чем edge (раскол влево/вправо), старт=FEED, ровно 1 исходящий линк
if (centerResult.powerLines.length <= edgeResult.powerLines.length) {
  ok = false
  console.error(
    'Center should have more lines than edge (split L/R):',
    centerResult.powerLines.length,
    'vs',
    edgeResult.powerLines.length,
  )
}

const screenCenterCol = Math.floor((centerConfig.cabinetsWide - 1) / 2)
console.log('Screen center col (0-based):', screenCenterCol)

for (const line of centerResult.powerLines) {
  const feed = getPowerTrunkCabinet(line, 'center')
  const start = line.cabinets[0]
  if (!start || feed.label !== start.label) {
    ok = false
    console.error(
      `Center P${line.lineNumber}: feed ${feed.label} != start ${start?.label}`,
    )
  }
  if (line.cabinets.length < 2) continue
  const out = centerResult.powerLinks.filter(
    (l) => l.chainId === line.lineNumber && l.from.label === start!.label,
  )
  if (out.length !== 1) {
    ok = false
    console.error(
      `Center P${line.lineNumber}: expected 1 out from ${start!.label} (no branch), got ${out.length}`,
    )
  } else {
    console.log(`P${line.lineNumber}: ${start!.label} → ${out[0]!.to.label}`)
  }
}

const schema = centerResult.routingSchema.join('\n')
if (!schema.includes('center feed') || !schema.includes('32A Robot')) {
  ok = false
  console.error('Routing schema missing center feed / 32A Robot labels')
}

const packing = centerResult.packingList.find((item) =>
  item.item.includes('Power Trunk'),
)
const outletCount = centerResult.powerLines.length
if (
  !packing?.notes.includes('32A PDU distro') ||
  !packing.notes.includes(`${outletCount} outlet`)
) {
  ok = false
  console.error('Packing list missing center feed distro notes:', packing?.notes)
}

const robotRow = buildEquipmentListState(
  [centerConfig],
  [{ screen: centerConfig, result: centerResult }],
  centerResult.cableSchedule,
  centerResult.packingList,
).rows.find((row) => row.id === 'robot-32a')
if (!robotRow?.russian.includes('center feed')) {
  ok = false
  console.error('Equipment robot row missing center feed note:', robotRow?.russian)
}

console.log(ok ? 'PASS' : 'FAIL')
process.exit(ok ? 0 : 1)
