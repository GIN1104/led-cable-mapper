import { computeRouting, buildAutoManualOverrides } from '../src/lib/routingEngine'
import { renumberLine } from '../src/lib/manualChains'
import { createScreen } from '../src/types'
import { fullRoutingKey } from '../src/lib/screenConfigHash'

const screen = createScreen({ name: 'Test', wallWidthM: 7, wallHeightM: 3 })

const overrides = buildAutoManualOverrides(screen)
const auto = computeRouting(screen)
const manual = computeRouting(screen, {
  manualModeData: true,
  manualModePower: true,
  manualOverrides: overrides,
})

console.log('Auto ports:', auto.summary.dataPorts)
console.log('Manual ports:', manual.summary.dataPorts)
console.log(
  'Keys match:',
  fullRoutingKey(screen, {
    manualModeData: true,
    manualModePower: true,
    manualOverrides: overrides,
  }),
)

const reassigned = {
  ...overrides,
  dataPorts: { ...overrides.dataPorts, A1: 99 },
  dataPortChains: {
    ...(overrides.dataPortChains ?? {}),
    99: [...((overrides.dataPortChains ?? {})[99] ?? []).filter((l) => l !== 'A1'), 'A1'],
  },
}
// Убрать A1 из старой цепочки, если переназначен
if (overrides.dataPorts.A1 != null && overrides.dataPorts.A1 !== 99) {
  const oldPort = overrides.dataPorts.A1
  const oldChain = (reassigned.dataPortChains[oldPort] ?? []).filter((l) => l !== 'A1')
  if (oldChain.length > 0) reassigned.dataPortChains[oldPort] = oldChain
  else delete reassigned.dataPortChains[oldPort]
}
const manual2 = computeRouting(screen, {
  manualModeData: true,
  manualModePower: false,
  manualOverrides: reassigned,
})
const a1Chain = manual2.dataChains.find((c) => c.cabinets.some((cab) => cab.label === 'A1'))
console.log('A1 reassigned to 99, chain port:', a1Chain?.portNumber)

if (!a1Chain || a1Chain.portNumber !== 99) {
  console.error('FAIL: manual reassignment not applied')
  process.exit(1)
}

// Порядок кликов: явная цепочка сохраняется
const sample = Object.keys(overrides.dataPorts).slice(0, 3)
if (sample.length >= 3) {
  const [a, b, c] = sample
  const ordered = computeRouting(screen, {
    manualModeData: true,
    manualModePower: false,
    manualOverrides: {
      dataPorts: { [a]: 1, [b]: 1, [c]: 1 },
      powerLines: {},
      dataStartPoints: { 1: a },
      dataPortChains: { 1: [a, c, b] },
    },
  })
  const chain = ordered.dataChains.find((ch) => ch.portNumber === 1)
  const labels = chain?.cabinets.map((cab) => cab.label) ?? []
  console.log('Click-order chain:', labels.join(' → '))
  if (labels[0] !== a || labels[1] !== c || labels[2] !== b) {
    console.error('FAIL: click order not preserved', labels)
    process.exit(1)
  }

  // Reverse: [a, c, b] → [b, c, a], start moves to former last
  const reversed = computeRouting(screen, {
    manualModeData: true,
    manualModePower: false,
    manualOverrides: {
      dataPorts: { [a]: 1, [b]: 1, [c]: 1 },
      powerLines: {},
      dataStartPoints: { 1: b },
      dataPortChains: { 1: [b, c, a] },
    },
  })
  const revChain = reversed.dataChains.find((ch) => ch.portNumber === 1)
  const revLabels = revChain?.cabinets.map((cab) => cab.label) ?? []
  console.log('Reversed chain:', revLabels.join(' → '))
  if (revLabels[0] !== b || revLabels[1] !== c || revLabels[2] !== a) {
    console.error('FAIL: reverse order not applied', revLabels)
    process.exit(1)
  }
}

// Перенумерация: move (целевая пуста) — ВСЕ кабинеты линии
{
  const moved = renumberLine(
    { 1: ['A1', 'A2', 'A3'] },
    { 1: 'A1' },
    { A1: 1, A2: 1, A3: 1 },
    1,
    4,
  )
  if (
    !moved ||
    moved.chains[4]?.join(',') !== 'A1,A2,A3' ||
    moved.chains[1] != null ||
    moved.assignments.A1 !== 4 ||
    moved.assignments.A2 !== 4 ||
    moved.assignments.A3 !== 4 ||
    moved.startPoints[4] !== 'A1' ||
    moved.startPoints[1] != null
  ) {
    console.error('FAIL: renumber move', moved)
    process.exit(1)
  }
  console.log('Renumber move: D1 → D4 (all cabinets) OK')
}

// Перенумерация: swap (обе линии заняты) — ВСЕ кабинеты обеих линий
{
  const swapped = renumberLine(
    { 1: ['A1', 'A2'], 4: ['B1', 'B2'] },
    { 1: 'A1', 4: 'B1' },
    { A1: 1, A2: 1, B1: 4, B2: 4 },
    1,
    4,
  )
  if (
    !swapped ||
    swapped.chains[1]?.join(',') !== 'B1,B2' ||
    swapped.chains[4]?.join(',') !== 'A1,A2' ||
    swapped.assignments.A1 !== 4 ||
    swapped.assignments.A2 !== 4 ||
    swapped.assignments.B1 !== 1 ||
    swapped.assignments.B2 !== 1 ||
    swapped.startPoints[1] !== 'B1' ||
    swapped.startPoints[4] !== 'A1'
  ) {
    console.error('FAIL: renumber swap', swapped)
    process.exit(1)
  }
  console.log('Renumber swap: D1 ↔ D4 (all cabinets) OK')
}

// Перенумерация: orphans в assignments (есть в карте, но нет в chain) — тоже переезжают
{
  const withOrphans = renumberLine(
    { 1: ['A1'] },
    { 1: 'A1' },
    { A1: 1, A2: 1, A3: 1 },
    1,
    7,
  )
  if (
    !withOrphans ||
    withOrphans.chains[7]?.join(',') !== 'A1,A2,A3' ||
    withOrphans.chains[1] != null ||
    withOrphans.assignments.A1 !== 7 ||
    withOrphans.assignments.A2 !== 7 ||
    withOrphans.assignments.A3 !== 7 ||
    withOrphans.startPoints[7] !== 'A1'
  ) {
    console.error('FAIL: renumber orphans in assignments', withOrphans)
    process.exit(1)
  }
  console.log('Renumber orphans: whole line including A2/A3 OK')
}

// Интеграция: полный auto-override data D1 → D4 — цвета/цепочки всей линии
{
  const auto = buildAutoManualOverrides(screen)
  const fromPort = 1
  const toPort = 4
  const onFrom = Object.entries(auto.dataPorts)
    .filter(([, n]) => n === fromPort)
    .map(([l]) => l)
  if (onFrom.length < 2) {
    console.error('FAIL: expected multi-cabinet data line for renumber integration')
    process.exit(1)
  }
  const renumbered = renumberLine(
    auto.dataPortChains ?? {},
    auto.dataStartPoints ?? {},
    auto.dataPorts,
    fromPort,
    toPort,
  )
  if (!renumbered) {
    console.error('FAIL: renumber integration null')
    process.exit(1)
  }
  const stillOnFrom = Object.entries(renumbered.assignments).filter(([, n]) => n === fromPort)
  const movedTo = Object.entries(renumbered.assignments).filter(([, n]) => n === toPort)
  if (stillOnFrom.length !== 0 || movedTo.length !== onFrom.length) {
    console.error('FAIL: renumber integration assignment count', {
      stillOnFrom: stillOnFrom.length,
      movedTo: movedTo.length,
      expected: onFrom.length,
    })
    process.exit(1)
  }
  if ((renumbered.chains[toPort] ?? []).length !== onFrom.length) {
    console.error('FAIL: renumber integration chain length', renumbered.chains[toPort]?.length)
    process.exit(1)
  }
  const routed = computeRouting(screen, {
    manualModeData: true,
    manualModePower: false,
    manualOverrides: {
      ...auto,
      dataPorts: renumbered.assignments,
      dataStartPoints: renumbered.startPoints,
      dataPortChains: renumbered.chains,
    },
  })
  const chain4 = routed.dataChains.find((c) => c.portNumber === toPort)
  const chain1 = routed.dataChains.find((c) => c.portNumber === fromPort)
  if (!chain4 || chain4.cabinets.length !== onFrom.length || chain1) {
    console.error('FAIL: renumber integration routing', {
      chain4: chain4?.cabinets.length,
      chain1: chain1?.portNumber,
    })
    process.exit(1)
  }
  console.log(
    `Renumber integration: ${onFrom.length} cabinets D${fromPort} → D${toPort}, routing OK`,
  )
}

const dataOnly = computeRouting(screen, {
  manualModeData: true,
  manualModePower: false,
  manualOverrides: overrides,
})
const powerOnly = computeRouting(screen, {
  manualModeData: false,
  manualModePower: true,
  manualOverrides: overrides,
})

if (dataOnly.summary.dataPorts !== manual.summary.dataPorts) {
  console.error('FAIL: data-only manual ports mismatch')
  process.exit(1)
}
if (powerOnly.summary.powerLines !== manual.summary.powerLines) {
  console.error('FAIL: power-only manual lines mismatch')
  process.exit(1)
}

console.log('PASS')
