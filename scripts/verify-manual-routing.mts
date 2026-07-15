import { computeRouting, buildAutoManualOverrides } from '../src/lib/routingEngine'
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
