/**
 * Разбор текста PDF-эскиза. Запуск: npm run verify:sketch
 */
import '../src/lib/pitchPresets.ts'
import { countCabinetGrid, gridFromAxisSegments, occupiedWithinBounds } from '../src/lib/sketchGrid.ts'
import {
  applySketchToScreen,
  fillReadingFromGrid,
  parseSketchText,
  sketchCanBuild,
} from '../src/lib/sketchPdf.ts'
import { createScreen } from '../src/types/index.ts'

let failed = 0
function assertEq(label: string, actual: unknown, expected: unknown) {
  const a = String(actual)
  const e = String(expected)
  if (a !== e) {
    console.error(`FAIL ${label}: expected ${e}, got ${a}`)
    failed++
  } else {
    console.log(`PASS ${label}: ${e}`)
  }
}

const plain = parseSketchText('Экран 6×4 м, питч 3.9 Big, подвес. שם האירוע: Концерт')
assertEq('width', plain.wallWidthM, 6)
assertEq('height', plain.wallHeightM, 4)
assertEq('pitch big', plain.pitchPreset, '3.9-big')
assertEq('hang', plain.hangMount, true)
assertEq('event', plain.eventName, 'Концерт')
assertEq('can build', sketchCanBuild(plain) ? 1 : 0, 1)

const mm = parseSketchText('Ширина: 6000 мм\nВысота: 3500 мм\n3.9 small')
assertEq('mm width', mm.wallWidthM, 6)
assertEq('mm height', mm.wallHeightM, 3.5)
assertEq('pitch small', mm.pitchPreset, '3.9-small')

const pixels = parseSketchText('разрешение 1920×1080, стена 8 x 3 м, 2.9')
assertEq('ignore pixels width', pixels.wallWidthM, 8)
assertEq('ignore pixels height', pixels.wallHeightM, 3)
assertEq('pitch 2.9', pixels.pitchPreset, '2.9')

const mix = parseSketchText('микс 4+3, экран 6×5.5 м, 3.9')
assertEq('mix big', mix.bigRows, 4)
assertEq('mix small', mix.smallRows, 3)

const missing = parseSketchText('просто рисунок без цифр')
assertEq('cannot build', sketchCanBuild(missing) ? 1 : 0, 0)

function drawGrid(
  cols: number,
  rows: number,
  cell: number,
  margin: number,
): { data: Uint8ClampedArray; width: number; height: number } {
  const width = margin * 2 + cols * cell
  const height = margin * 2 + rows * cell
  const data = new Uint8ClampedArray(width * height * 4)
  data.fill(255)
  const ink = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const index = (y * width + x) * 4
    data[index] = 0
    data[index + 1] = 0
    data[index + 2] = 0
  }
  const x0 = margin
  const y0 = margin
  for (let col = 0; col <= cols; col++) {
    const x = x0 + col * cell
    for (let y = y0; y <= y0 + rows * cell; y++) {
      ink(x, y)
      ink(x + 1, y)
    }
  }
  for (let row = 0; row <= rows; row++) {
    const y = y0 + row * cell
    for (let x = x0; x <= x0 + cols * cell + 1; x++) {
      ink(x, y)
      ink(x, y + 1)
    }
  }
  return { data, width, height }
}

const drawn = drawGrid(12, 5, 24, 30)
const counted = countCabinetGrid(drawn.data, drawn.width, drawn.height)
assertEq('grid wide', counted?.cabinetsWide, 12)
assertEq('grid high', counted?.cabinetsHigh, 5)
assertEq('grid full', counted?.occupied.every((row) => row.every(Boolean)) ? 1 : 0, 1)

function drawMask(mask: boolean[][], cell: number, margin: number) {
  const rows = mask.length
  const cols = mask[0].length
  const width = margin * 2 + cols * cell
  const height = margin * 2 + rows * cell
  const data = new Uint8ClampedArray(width * height * 4)
  data.fill(255)
  const ink = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const index = (y * width + x) * 4
    data[index] = 0
    data[index + 1] = 0
    data[index + 2] = 0
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (!mask[row][col]) continue
      const x0 = margin + col * cell
      const y0 = margin + row * cell
      for (let x = x0; x <= x0 + cell; x++) {
        ink(x, y0)
        ink(x, y0 + 1)
        ink(x, y0 + cell)
        ink(x, y0 + cell + 1)
      }
      for (let y = y0; y <= y0 + cell; y++) {
        ink(x0, y)
        ink(x0 + 1, y)
        ink(x0 + cell, y)
        ink(x0 + cell + 1, y)
      }
    }
  }
  return { data, width, height }
}

const shape = [
  [true, true, false, false],
  [true, true, true, true],
  [true, true, true, true],
]
const shaped = drawMask(shape, 28, 26)
const shapeGrid = countCabinetGrid(shaped.data, shaped.width, shaped.height)
assertEq('shape wide', shapeGrid?.cabinetsWide, 4)
assertEq('shape high', shapeGrid?.cabinetsHigh, 3)
assertEq('shape top', shapeGrid?.occupied[0]?.map((cell) => (cell ? 1 : 0)).join(''), '1100')

function rectSegments(x: number, y: number, w: number, h: number) {
  return [
    { x1: x, y1: y, x2: x + w, y2: y },
    { x1: x + w, y1: y, x2: x + w, y2: y + h },
    { x1: x + w, y1: y + h, x2: x, y2: y + h },
    { x1: x, y1: y + h, x2: x, y2: y },
  ]
}
const vectorSegs = []
for (let row = 0; row < 3; row++) {
  for (let col = 0; col < 4; col++) {
    if (row === 0 && col >= 2) continue
    vectorSegs.push(...rectSegments(40 + col * 30, 40 + row * 30, 30, 30))
  }
}
const vectorGrid = gridFromAxisSegments(vectorSegs)
assertEq('vector wide', vectorGrid?.cabinetsWide, 4)
assertEq('vector high', vectorGrid?.cabinetsHigh, 3)
assertEq('vector top', vectorGrid?.occupied[0]?.map((cell) => (cell ? 1 : 0)).join(''), '1100')

const fromPicture = parseSketchText('эскиз без размеров')
if (shapeGrid) fillReadingFromGrid(fromPicture, shapeGrid)
assertEq('shape empty', fromPicture.emptyCabinets.slice().sort().join(','), 'C3,C4')
assertEq('picture width m', fromPicture.wallWidthM, 2)
assertEq('picture height m', fromPicture.wallHeightM, 1.5)
assertEq('picture pitch', fromPicture.pitchPreset, '3.9-small')
assertEq('picture can build', sketchCanBuild(fromPicture) ? 1 : 0, 1)

const keepText = parseSketchText('экран 10×5.5 м, 3.9 small')
if (shapeGrid) fillReadingFromGrid(keepText, shapeGrid)
assertEq('keep text width', keepText.wallWidthM, 10)
assertEq('keep text height', keepText.wallHeightM, 5.5)

const pictureScreen = applySketchToScreen(createScreen({ name: 'P' }), fromPicture)
assertEq('picture cabs wide', pictureScreen.cabinetsWide, 4)
assertEq('picture cabs high', pictureScreen.cabinetsHigh, 3)
assertEq('picture empty', pictureScreen.emptyCabinets.slice().sort().join(','), 'C3,C4')

const shapeBounds = {
  left: 26 / shaped.width,
  top: 26 / shaped.height,
  right: (26 + 4 * 28) / shaped.width,
  bottom: (26 + 3 * 28) / shaped.height,
}
const within = occupiedWithinBounds(
  shaped.data,
  shaped.width,
  shaped.height,
  4,
  3,
  shapeBounds,
)
assertEq('within top', within[0]?.map((cell) => (cell ? 1 : 0)).join(''), '1100')
assertEq(
  'within empty count',
  within.flat().filter((cell) => !cell).length,
  2,
)

const fullBounds = { left: 0, top: 0, right: 1, bottom: 1 }
const withinFull = occupiedWithinBounds(
  shaped.data,
  shaped.width,
  shaped.height,
  4,
  3,
  fullBounds,
)
assertEq('within-full top', withinFull[0]?.map((cell) => (cell ? 1 : 0)).join(''), '1100')

const screen = applySketchToScreen(createScreen({ name: 'S' }), plain)
assertEq('applied wide m', screen.wallWidthM, 6)
assertEq('applied high m', screen.wallHeightM, 4)
assertEq('applied preset', screen.pitchPreset, '3.9-big')
assertEq('applied rows', screen.cabinetsHigh, 4)

if (failed > 0) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nSketch PDF checks passed.')
