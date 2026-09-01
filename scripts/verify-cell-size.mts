import { verifyPresetAspects } from '../src/lib/cabinetCellSize.ts'

let failed = false
for (const mobile of [false, true]) {
  const label = mobile ? 'mobile' : 'desktop'
  const { ok, failures } = verifyPresetAspects(mobile)
  if (ok) {
    console.log(`OK ${label}: все пресеты сохраняют pixel aspect`)
  } else {
    failed = true
    console.error(`FAIL ${label}:`)
    for (const f of failures) console.error(`  - ${f}`)
  }
}
process.exit(failed ? 1 : 0)
