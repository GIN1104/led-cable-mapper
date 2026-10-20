import { schemeDisplaySize, schemeImageSpan } from '../src/lib/schemeImageLayout.ts'

const data = schemeDisplaySize(2400, 1200, 2)
const power = schemeDisplaySize(1800, 3000, 2)
if (data.width !== 980) {
  throw new Error(`data width ${data.width}, expected 980`)
}
if (data.height !== 490) {
  throw new Error(`data height ${data.height}, expected 490`)
}

const first = schemeImageSpan(40, data.height)
const second = schemeImageSpan(first.nextRow, power.height)
if (second.imageStart <= first.imageStart + first.rows - 1) {
  throw new Error(
    `power image overlaps data: data rows ${first.imageStart}..${first.imageStart + first.rows - 1}, power starts ${second.imageStart}`,
  )
}
if (second.nextRow <= second.imageStart) {
  throw new Error('power span is empty')
}

console.log(
  `ok data ${first.imageStart}+${first.rows} then power ${second.imageStart}+${second.rows}`,
)
