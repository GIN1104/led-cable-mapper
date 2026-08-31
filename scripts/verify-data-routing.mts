/**
 * Проверка авто-маршрутизации data.
 * Запуск: npx tsx scripts/verify-data-routing.mts
 */
import type { RefreshRate, ScreenConfig } from '../src/types/index.ts'
import { EMPTY_MANUAL_OVERRIDES } from '../src/types/index.ts'
import { applyPitchPreset } from '../src/lib/pitchPresets.ts'
import { buildDataChains } from '../src/lib/dataRouting.ts'
import { computeRouting } from '../src/lib/routingEngine.ts'
import {
  calcPixelsPerCabinet,
  filterActiveCabinets,
  generateCabinetGrid,
  syncCabinetGridFromMeters,
} from '../src/lib/cabinetGrid.ts'
import {
  getMaxCabinetsPerDataPort,
  getMaxPixelsPerDataPort,
} from '../src/lib/constants.ts'

function makeConfig(
  wallWidthM: number,
  wallHeightM: number,
  refreshRate: RefreshRate = 60,
): ScreenConfig {
  const base = syncCabinetGridFromMeters({
    id: 'test',
    name: 'Test',
    emptyCabinets: [],
    wallWidthM,
    wallHeightM,
    cabinetsWide: 1,
    cabinetsHigh: 1,
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
    signalBackup: false,
    trunkLengthM: 15,
    refreshRate,
    chainStartEdge: 'left',
    powerFeedMode: 'edge',
    hangMount: false,
    stripWidths: [],
  })
  return applyPitchPreset(base, '3.9-big')
}

function runCase(
  wallWidthM: number,
  wallHeightM: number,
  label: string,
  refreshRate: RefreshRate = 60,
) {
  const config = makeConfig(wallWidthM, wallHeightM, refreshRate)
  const cabs = filterActiveCabinets(generateCabinetGrid(config), new Set())
  const pixelsPerCabinet = calcPixelsPerCabinet(config).totalPixels
  const maxCabs = getMaxCabinetsPerDataPort(config.refreshRate, pixelsPerCabinet)
  const maxPixels = getMaxPixelsPerDataPort(config.refreshRate)
  const { chains, links } = buildDataChains(cabs, config, pixelsPerCabinet)

  console.log(
    `\n=== ${label} (${config.cabinetsWide}×${config.cabinetsHigh} @${refreshRate}Hz) ===`,
  )
  console.log(`px/cab: ${pixelsPerCabinet}, maxCabs/port: ${maxCabs}`)
  console.log(`ports: ${chains.length}, links: ${links.length}`)

  for (const chain of chains) {
    const rows = [...new Set(chain.cabinets.map((c) => c.row))].sort((a, b) => a - b)
    const labels = chain.cabinets.map((c) => c.label).join(' → ')
    console.log(
      `D${chain.portNumber} (${chain.cabinets.length} cab, ${chain.totalPixels} px, rows ${rows.join(',')}): ${labels}`,
    )
  }

  return { config, chains, links, maxCabs, maxPixels, pixelsPerCabinet }
}

function assertChainLimits(
  chains: ReturnType<typeof runCase>['chains'],
  maxCabs: number,
  maxPixels: number,
  label: string,
): boolean {
  let ok = true
  for (const chain of chains) {
    if (chain.cabinets.length > maxCabs) {
      ok = false
      console.error(
        `FAIL ${label}: D${chain.portNumber} has ${chain.cabinets.length} cabs (max ${maxCabs})`,
      )
    }
    if (chain.totalPixels > maxPixels) {
      ok = false
      console.error(
        `FAIL ${label}: D${chain.portNumber} has ${chain.totalPixels} px (max ${maxPixels})`,
      )
    }
  }
  return ok
}

/** Доля горизонтальных шагов в цепочке (data идёт по рядам LTR/RTL) */
function horizontalLinkRatio(chain: ReturnType<typeof runCase>['chains'][0]): number {
  if (chain.cabinets.length < 2) return 1
  let horiz = 0
  for (let i = 0; i < chain.cabinets.length - 1; i++) {
    if (chain.cabinets[i].row === chain.cabinets[i + 1].row) horiz++
  }
  return horiz / (chain.cabinets.length - 1)
}

/** В каждом ряду порядок монотонный (LTR или RTL), не column-first */
function rowsTraverseHorizontally(chain: ReturnType<typeof runCase>['chains'][0]): boolean {
  const byRow = new Map<number, number[]>()
  for (const cab of chain.cabinets) {
    const cols = byRow.get(cab.row) ?? []
    cols.push(cab.col)
    byRow.set(cab.row, cols)
  }
  for (const cols of byRow.values()) {
    if (cols.length < 2) continue
    const ltr = cols.every((c, i) => i === 0 || c > cols[i - 1])
    const rtl = cols.every((c, i) => i === 0 || c < cols[i - 1])
    if (!ltr && !rtl) return false
  }
  return true
}

function assertHorizontalDataFlow(
  chains: ReturnType<typeof runCase>['chains'],
  label: string,
): boolean {
  let ok = true
  for (const chain of chains) {
    if (!rowsTraverseHorizontally(chain)) {
      ok = false
      console.error(`FAIL ${label}: D${chain.portNumber} has non-horizontal row traversal`)
    }
    const ratio = horizontalLinkRatio(chain)
    if (ratio < 0.5) {
      ok = false
      console.error(
        `FAIL ${label}: D${chain.portNumber} horizontal link ratio ${(ratio * 100).toFixed(0)}% (need ≥50%)`,
      )
    }
  }
  return ok
}

let ok = true

// 10m × 5m @60Hz → 20×5, maxCabs=19 → 6 портов (теор. минимум ceil(100/19))
const r10x5_60 = runCase(10, 5, '10m×5m 3.9 Big', 60)
const bottomRow = r10x5_60.config.cabinetsHigh - 1
const d1 = r10x5_60.chains[0]
if (!d1) {
  ok = false
  console.error('FAIL: no D1')
} else {
  const d1Rows = new Set(d1.cabinets.map((c) => c.row))
  if (!d1Rows.has(bottomRow)) {
    ok = false
    console.error(`FAIL: D1 should include bottom row ${bottomRow}, got rows ${[...d1Rows]}`)
  }
  if (r10x5_60.chains.length !== 6) {
    ok = false
    console.error(`FAIL 10×5@60Hz: expected 6 ports (min packing), got ${r10x5_60.chains.length}`)
  }
  if (!assertChainLimits(r10x5_60.chains, r10x5_60.maxCabs, r10x5_60.maxPixels, '10×5@60')) {
    ok = false
  }
  if (r10x5_60.links.length === 0) {
    ok = false
    console.error('FAIL: no data links')
  }
  if (!assertHorizontalDataFlow(r10x5_60.chains, '10×5@60')) {
    ok = false
  }
}

// 10m × 5m @50Hz → 20 cabs/row ≤ 23 → 5 портов (по одному ряду)
const r10x5_50 = runCase(10, 5, '10m×5m 3.9 Big', 50)
if (r10x5_50.chains.length !== 5) {
  ok = false
  console.error(`FAIL 10×5@50Hz: expected 5 ports, got ${r10x5_50.chains.length}`)
}
if (!assertChainLimits(r10x5_50.chains, r10x5_50.maxCabs, r10x5_50.maxPixels, '10×5@50')) {
  ok = false
}

// 7m × 3m → 14×3, каждый ряд 14 cab ≤ 19 → 3 порта
const r7x3 = runCase(7, 3, '7m×3m 3.9 Big')
if (r7x3.chains.length !== 3) {
  ok = false
  console.error(`FAIL 7×3: expected 3 ports, got ${r7x3.chains.length}`)
}
for (const chain of r7x3.chains) {
  if (chain.cabinets.length > r7x3.maxCabs) {
    ok = false
    console.error(`FAIL 7×3: D${chain.portNumber} has ${chain.cabinets.length} cabs (max ${r7x3.maxCabs})`)
  }
}
if (!assertChainLimits(r7x3.chains, r7x3.maxCabs, r7x3.maxPixels, '7×3')) {
  ok = false
}
if (r7x3.links.length === 0) {
  ok = false
  console.error('FAIL 7×3: no links')
}
if (!assertHorizontalDataFlow(r7x3.chains, '7×3')) {
  ok = false
}

// 7m × 3m @50Hz → 14×3, maxCabs=23 → 2 порта (вертикальное деление 7|7)
const r7x3_50 = runCase(7, 3, '7m×3m 3.9 Big', 50)
if (r7x3_50.chains.length !== 2) {
  ok = false
  console.error(`FAIL 7×3@50Hz: expected 2 ports, got ${r7x3_50.chains.length}`)
}
if (!assertChainLimits(r7x3_50.chains, r7x3_50.maxCabs, r7x3_50.maxPixels, '7×3@50')) {
  ok = false
}

// 8m × 3m → 16×3, 16≤19 → 3 порта (не 4 как у grid-partition)
const r8x3 = runCase(8, 3, '8m×3m 3.9 Big')
if (r8x3.chains.length !== 3) {
  ok = false
  console.error(`FAIL 8×3: expected 3 ports, got ${r8x3.chains.length}`)
}
if (!assertChainLimits(r8x3.chains, r8x3.maxCabs, r8x3.maxPixels, '8×3')) {
  ok = false
}

// 14m × 8m @50Hz → 28×8, maxCabs=23 → 10 портов (теор. минимум ceil(224/23))
const r14x8_50 = runCase(14, 8, '14m×8m 3.9 Big', 50)
if (r14x8_50.chains.length !== 10) {
  ok = false
  console.error(`FAIL 14×8@50Hz: expected 10 ports, got ${r14x8_50.chains.length}`)
}
if (!assertChainLimits(r14x8_50.chains, r14x8_50.maxCabs, r14x8_50.maxPixels, '14×8@50')) {
  ok = false
}
if (!assertHorizontalDataFlow(r14x8_50.chains, '14×8@50')) {
  ok = false
}

// 14m × 8m @60Hz → 28×8, maxCabs=19 → 12 портов (теор. минимум ceil(224/19))
const r14x8_60 = runCase(14, 8, '14m×8m 3.9 Big', 60)
if (r14x8_60.chains.length !== 12) {
  ok = false
  console.error(`FAIL 14×8@60Hz: expected 12 ports, got ${r14x8_60.chains.length}`)
}
if (!assertChainLimits(r14x8_60.chains, r14x8_60.maxCabs, r14x8_60.maxPixels, '14×8@60')) {
  ok = false
}
if (!assertHorizontalDataFlow(r14x8_60.chains, '14×8@60')) {
  ok = false
}

// 28×4 м, 4 блока: auto не пересекает границы, manual может пересечь намеренно.
const stripBase = makeConfig(28, 4, 50)
const stripConfig: ScreenConfig = {
  ...stripBase,
  signalBackup: true,
  stripWidths: [14, 14, 14, 14],
}
const stripResult = computeRouting(stripConfig)
const stripForCol = (col: number) => Math.floor(col / 14)

for (const chain of [...stripResult.dataChains, ...stripResult.backupChains]) {
  const strips = new Set(chain.cabinets.map((cab) => stripForCol(cab.col)))
  if (strips.size > 1) {
    ok = false
    console.error(`FAIL 28×4 strips: D${chain.portNumber} crosses blocks`)
  }
}
for (const link of [...stripResult.dataLinks, ...stripResult.backupLinks]) {
  if (stripForCol(link.from.col) !== stripForCol(link.to.col)) {
    ok = false
    console.error(
      `FAIL 28×4 strips: ${link.from.label}→${link.to.label} crosses blocks`,
    )
  }
}

const leftBoundary = stripResult.cabinets.find((cab) => cab.col === 13 && cab.row === 0)
const rightBoundary = stripResult.cabinets.find((cab) => cab.col === 14 && cab.row === 0)
if (!leftBoundary || !rightBoundary) {
  ok = false
  console.error('FAIL 28×4 strips: boundary cabinets not found')
} else {
  const manualResult = computeRouting(stripConfig, {
    manualModeData: true,
    manualModePower: false,
    manualOverrides: {
      ...EMPTY_MANUAL_OVERRIDES,
      dataPorts: {
        [leftBoundary.label]: 99,
        [rightBoundary.label]: 99,
      },
      dataStartPoints: { 99: leftBoundary.label },
      dataPortChains: {
        99: [leftBoundary.label, rightBoundary.label],
      },
    },
  })
  const manualChain = manualResult.dataChains.find((chain) => chain.portNumber === 99)
  if (manualChain?.cabinets.length !== 2 || manualResult.dataLinks.length !== 1) {
    ok = false
    console.error('FAIL 28×4 strips: manual cross-block line was blocked')
  }
}

console.log(ok ? '\nPASS' : '\nFAIL')
process.exit(ok ? 0 : 1)
