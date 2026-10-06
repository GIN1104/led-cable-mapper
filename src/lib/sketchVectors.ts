import type { PDFPageProxy } from 'pdfjs-dist'
import { gridFromAxisSegments, type AxisSegment, type GridCount } from './sketchGrid'

type Matrix = [number, number, number, number, number, number]

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

function multiply(left: Matrix, right: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = left
  const [a2, b2, c2, d2, e2, f2] = right
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ]
}

function applyMatrix(matrix: Matrix, x: number, y: number): [number, number] {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]
}

/**
 * Линии сетки из векторных операторов PDF.
 * Если страница — вставленная картинка, отрезков почти нет и функция вернёт null.
 */
export async function gridFromPdfVectors(page: PDFPageProxy): Promise<GridCount | null> {
  const pdfjs = await import('pdfjs-dist')
  const opList = await page.getOperatorList()
  // Совпадает с DrawOPS в pdf.js: в публичный экспорт пакета константы не входят
  const drawMoveTo = 0
  const drawLineTo = 1
  const drawCurveTo = 2
  const drawQuadTo = 3
  const drawClose = 4
  const viewport = page.getViewport({ scale: 2 })
  const stack: Matrix[] = []
  let ctm: Matrix = IDENTITY
  const segments: AxisSegment[] = []

  const pushLine = (x1: number, y1: number, x2: number, y2: number) => {
    const [ax, ay] = applyMatrix(ctm, x1, y1)
    const [bx, by] = applyMatrix(ctm, x2, y2)
    const [vx1, vy1] = viewport.convertToViewportPoint(ax, ay)
    const [vx2, vy2] = viewport.convertToViewportPoint(bx, by)
    segments.push({ x1: vx1, y1: vy1, x2: vx2, y2: vy2 })
  }

  const { OPS } = pdfjs
  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i]
    const args = (opList.argsArray[i] ?? null) as unknown[] | null
    if (fn === OPS.save) {
      stack.push(ctm)
      continue
    }
    if (fn === OPS.restore) {
      ctm = stack.pop() ?? IDENTITY
      continue
    }
    if (fn === OPS.transform && args && args.length >= 6) {
      const next: Matrix = [
        Number(args[0]),
        Number(args[1]),
        Number(args[2]),
        Number(args[3]),
        Number(args[4]),
        Number(args[5]),
      ]
      ctm = multiply(ctm, next)
      continue
    }
    if (fn !== OPS.constructPath || !args) continue
    const data = args[1]
    const path = Array.isArray(data) ? (data[0] as ArrayLike<number> | undefined) : undefined
    if (!path || typeof path.length !== 'number') continue

    let cursorX = 0
    let cursorY = 0
    let startX = 0
    let startY = 0
    for (let k = 0; k < path.length; ) {
      const op = path[k++]
      if (op === drawMoveTo) {
        cursorX = path[k++]
        cursorY = path[k++]
        startX = cursorX
        startY = cursorY
      } else if (op === drawLineTo) {
        const x = path[k++]
        const y = path[k++]
        pushLine(cursorX, cursorY, x, y)
        cursorX = x
        cursorY = y
      } else if (op === drawCurveTo) {
        k += 4
        cursorX = path[k++]
        cursorY = path[k++]
      } else if (op === drawQuadTo) {
        k += 2
        cursorX = path[k++]
        cursorY = path[k++]
      } else if (op === drawClose) {
        pushLine(cursorX, cursorY, startX, startY)
        cursorX = startX
        cursorY = startY
      } else {
        break
      }
    }
  }

  return gridFromAxisSegments(segments, { width: viewport.width, height: viewport.height })
}
