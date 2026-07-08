import { computeRouting, buildAutoManualOverrides } from '../src/lib/routingEngine'
import { createScreen } from '../src/types'
import { fullRoutingKey } from '../src/lib/screenConfigHash'

const screen = createScreen({ name: 'Test', wallWidthM: 7, wallHeightM: 3 })

const overrides = buildAutoManualOverrides(screen)
const auto = computeRouting(screen)
const manual = computeRouting(screen, { manualMode: true, manualOverrides: overrides })

console.log('Auto ports:', auto.summary.dataPorts)
console.log('Manual ports:', manual.summary.dataPorts)
console.log('Keys match:', fullRoutingKey(screen, { manualMode: true, manualOverrides: overrides }))

const reassigned = {
  ...overrides,
  dataPorts: { ...overrides.dataPorts, A1: 99 },
}
const manual2 = computeRouting(screen, { manualMode: true, manualOverrides: reassigned })
const a1Chain = manual2.dataChains.find((c) => c.cabinets.some((cab) => cab.label === 'A1'))
console.log('A1 reassigned to 99, chain port:', a1Chain?.portNumber)

if (!a1Chain || a1Chain.portNumber !== 99) {
  console.error('FAIL: manual reassignment not applied')
  process.exit(1)
}
console.log('PASS')
