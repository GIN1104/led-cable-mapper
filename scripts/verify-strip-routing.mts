/**
 * Проверка маршрутизации по отдельным блокам/стрипам.
 * Auto data, backup и power не должны пересекать границы блоков.
 */
import type { PitchPresetId, ScreenConfig } from '../src/types/index.ts'
import { createScreen } from '../src/types/index.ts'
import {
  equalStripWidths,
  stripIndexForCol,
  syncCabinetGridFromMeters,
} from '../src/lib/cabinetGrid.ts'
import { applyPitchPreset } from '../src/lib/pitchPresets.ts'
import { computeRouting } from '../src/lib/routingEngine.ts'

interface StripCase {
  label: string
  widthM: number
  heightM: number
  preset: PitchPresetId
  stripCount: number
  dualVx1000?: boolean
}

const cases: StripCase[] = [
  {
    label: '28×4m · 3.9 Big · 4 блока',
    widthM: 28,
    heightM: 4,
    preset: '3.9-big',
    stripCount: 4,
  },
  {
    label: '28×4m · 3.9 Small · 4 блока',
    widthM: 28,
    heightM: 4,
    preset: '3.9-small',
    stripCount: 4,
  },
  {
    label: '14×4m · Reshet · 4 блока',
    widthM: 14,
    heightM: 4,
    preset: '3.9-reshet',
    stripCount: 4,
  },
  {
    label: '14×4m · 2.9 · 4 блока',
    widthM: 14,
    heightM: 4,
    preset: '2.9',
    stripCount: 4,
  },
  {
    label: '7×3m · 3.9 Big · 3 неровных блока',
    widthM: 7,
    heightM: 3,
    preset: '3.9-big',
    stripCount: 3,
  },
  {
    label: '6×3.5m · 3.9 Small · 4 блока',
    widthM: 6,
    heightM: 3.5,
    preset: '3.9-small',
    stripCount: 4,
  },
  {
    label: '28×4m · 3.9 Big · 4 блока · dual VX',
    widthM: 28,
    heightM: 4,
    preset: '3.9-big',
    stripCount: 4,
    dualVx1000: true,
  },
]

function makeConfig(test: StripCase): ScreenConfig {
  const base = createScreen({
    id: `strip-${test.preset}-${test.stripCount}-${test.dualVx1000 ? 'dual' : 'single'}`,
    name: test.label,
    wallWidthM: test.widthM,
    wallHeightM: test.heightM,
    signalBackup: true,
    refreshRate: 60,
    chainStartEdge: 'right',
    powerFeedMode: 'edge',
  })
  const withPreset = syncCabinetGridFromMeters(
    applyPitchPreset(base, test.preset),
  )
  return {
    ...withPreset,
    stripWidths: equalStripWidths(test.stripCount, withPreset.cabinetsWide),
    dualVx1000: test.dualVx1000 ?? false,
  }
}

function sameLabelSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((label) => set.has(label))
}

let allOk = true

for (const test of cases) {
  const config = makeConfig(test)
  const result = computeRouting(config)
  const activeLabels = result.cabinets
    .filter((cab) => !config.emptyCabinets.includes(cab.label))
    .map((cab) => cab.label)
  let ok = true

  const assertEntitiesStayInStrip = (
    name: string,
    entities: Array<{ cabinets: Array<{ col: number }>; lineNumber?: number; portNumber?: number }>,
  ) => {
    for (const entity of entities) {
      const strips = new Set(
        entity.cabinets.map((cab) => stripIndexForCol(cab.col, config.stripWidths)),
      )
      if (strips.size > 1) {
        ok = false
        const id = entity.portNumber ?? entity.lineNumber ?? '?'
        console.error(`  FAIL ${name}${id}: переход между блоками`)
      }
    }
  }

  const assertLinksStayInStrip = (
    name: string,
    links: Array<{ from: { col: number; label: string }; to: { col: number; label: string } }>,
  ) => {
    for (const link of links) {
      const fromStrip = stripIndexForCol(link.from.col, config.stripWidths)
      const toStrip = stripIndexForCol(link.to.col, config.stripWidths)
      if (fromStrip !== toStrip) {
        ok = false
        console.error(`  FAIL ${name}: ${link.from.label}→${link.to.label}`)
      }
    }
  }

  assertEntitiesStayInStrip('D', result.dataChains)
  assertEntitiesStayInStrip('B', result.backupChains)
  assertEntitiesStayInStrip('P', result.powerLines)
  assertLinksStayInStrip('data link', result.dataLinks)
  assertLinksStayInStrip('backup link', result.backupLinks)
  assertLinksStayInStrip('power link', result.powerLinks)

  const dataLabels = result.dataChains.flatMap((chain) =>
    chain.cabinets.map((cab) => cab.label),
  )
  const powerLabels = result.powerLines.flatMap((line) =>
    line.cabinets.map((cab) => cab.label),
  )
  if (!sameLabelSet(dataLabels, activeLabels)) {
    ok = false
    console.error('  FAIL data: неполное или повторное покрытие')
  }
  if (!sameLabelSet(powerLabels, activeLabels)) {
    ok = false
    console.error('  FAIL power: неполное или повторное покрытие')
  }

  if (result.backupChains.length !== result.dataChains.length) {
    ok = false
    console.error('  FAIL backup: количество не совпадает с main')
  }
  for (const backup of result.backupChains) {
    const main = result.dataChains.find(
      (chain) => chain.portNumber === backup.backupForPort,
    )
    if (
      !main ||
      !sameLabelSet(
        backup.cabinets.map((cab) => cab.label),
        main.cabinets.map((cab) => cab.label),
      )
    ) {
      ok = false
      console.error(`  FAIL backup D${backup.portNumber}: состав не совпадает`)
    }
  }

  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${test.label}: ` +
      `${config.cabinetsWide}×${config.cabinetsHigh}, ` +
      `D${result.dataChains.length}/B${result.backupChains.length}/P${result.powerLines.length}`,
  )
  allOk = allOk && ok
}

console.log(allOk ? '\nALL STRIP CONFIGURATIONS PASS' : '\nSTRIP CONFIGURATION FAILURES')
process.exit(allOk ? 0 : 1)
