import fs from 'node:fs'
import '../src/lib/pitchPresets.ts'
import { createScreen } from '../src/types/index.ts'
import { computeRouting } from '../src/lib/routingEngine.ts'
import {
  buildNovaLctRegions,
  encodeNovaLctScr,
  getNovaLctScrFilename,
} from '../src/lib/novaLctScr.ts'

let failed = 0
function assertEq(name: string, actual: unknown, expected: unknown) {
  const ok = actual === expected
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${String(actual)}`)
  if (!ok) {
    console.log(`  expected: ${String(expected)}`)
    failed++
  }
}

function crc16(data: Uint8Array, initial = 0): number {
  let acc = initial & 0xffff
  for (let i = 0; i < data.length; i++) acc = (acc + data[i]!) & 0xffff
  return acc
}

const screen = createScreen({
  name: 'Test Wall',
  wallWidthM: 6,
  wallHeightM: 2.5,
  pitchPreset: '3.9-small',
})
const result = computeRouting(screen)
const chains = result.dataChains.filter((c) => !c.isBackup)
assertEq('has data chains', chains.length > 0 ? 1 : 0, 1)

const regions = buildNovaLctRegions(result.dataChains, screen)
assertEq('regions match cabinets', regions.length, result.summary.totalCabinets)

const bytes = encodeNovaLctScr(result.dataChains, screen)
assertEq('DSCI header', String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!), 'DSCI')
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
const dviLen = view.getUint32(6, true)
const screenLen = view.getUint32(10, true)
const adjustLen = view.getUint16(14, true)
assertEq('dvi len 128', dviLen, 128)
assertEq('has screen', screenLen > 0 ? 1 : 0, 1)
assertEq('has adjust', adjustLen, 173)
assertEq('total size', bytes.length, 54 + dviLen + screenLen + adjustLen)
assertEq(
  'file crc',
  view.getUint16(4, true),
  crc16(bytes.subarray(6, bytes.length - adjustLen)),
)

const screenOff = 54 + dviLen
assertEq('screen version', view.getUint16(screenOff, true), 1006)
assertEq(
  'screen crc',
  view.getUint16(screenOff + 2, true),
  crc16(bytes.subarray(screenOff + 4, screenOff + screenLen)),
)
assertEq('screen count', bytes[screenOff + 132], 1)
const blobLen = view.getUint32(screenOff + 133, true)
const blobOff = screenOff + 137
assertEq('blob type Standard', bytes[blobOff], 1)
assertEq('blob cols', view.getUint16(blobOff + 6, true), screen.cabinetsWide)
assertEq('blob rows', view.getUint16(blobOff + 8, true), screen.cabinetsHigh)

// Первый регион = колонка 0, ряд 0 (column-major)
const r0 = blobOff + 10
assertEq('region0 x', view.getUint16(r0 + 4, true), 0)
assertEq('region0 y', view.getUint16(r0 + 6, true), 0)
assertEq('region0 xIn=col', view.getUint16(r0 + 8, true), 0)
assertEq('region0 yIn=row', view.getUint16(r0 + 10, true), 0)
assertEq('region0 dviIndex', bytes[r0 + 16], 1)

// Второй регион = та же колонка, ряд 1
const r1 = r0 + 17
assertEq('region1 xIn=col', view.getUint16(r1 + 8, true), 0)
assertEq('region1 yIn=row', view.getUint16(r1 + 10, true), 1)

const dviExtPos = view.getUint32(screenOff + 28, true)
assertEq('dviExt after blob', dviExtPos, 137 + blobLen)
const jsonLen = view.getUint16(screenOff + dviExtPos, true)
const json = Buffer.from(
  bytes.subarray(screenOff + dviExtPos + 2, screenOff + dviExtPos + 2 + jsonLen),
).toString('utf8')
assertEq('dviExt json starts', json.startsWith('[{') ? 1 : 0, 1)

assertEq('filename', getNovaLctScrFilename('Test Wall', 'Show 1'), 'Show-1-tikshoret.scr')

const firstChain = chains[0]!
const firstRegions = regions.filter(
  (r) => r.portIndex === Math.max(0, (firstChain.localNumber ?? firstChain.portNumber) - 1),
)
assertEq('first chain length', firstRegions.length, firstChain.cabinets.length)
assertEq('connect starts at 0', firstRegions[0]?.connectIndex, 0)
assertEq(
  'connect ends at n-1',
  firstRegions[firstRegions.length - 1]?.connectIndex,
  firstChain.cabinets.length - 1,
)

// Сверка каркаса с пользовательским образцом, если файл на месте
const samplePath = 'c:/Users/starc/Downloads/forCursor.scr'
if (fs.existsSync(samplePath)) {
  const sample = fs.readFileSync(samplePath)
  const sView = new DataView(sample.buffer, sample.byteOffset, sample.byteLength)
  assertEq('sample magic', sample.subarray(0, 4).toString('ascii'), 'DSCI')
  assertEq('sample dviLen', sView.getUint32(6, true), 128)
  assertEq('sample screenVer', sView.getUint16(54 + 128, true), 1006)
  assertEq('sample adjustLen', sView.getUint16(14, true), 173)
  console.log('sample size', sample.length, 'ours', bytes.length)
}

if (failed > 0) {
  console.error(`\n${failed} NovaLCT checks failed`)
  process.exit(1)
}
console.log('\nNovaLCT .scr checks passed.')
