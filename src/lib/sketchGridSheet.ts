import { cabinetLabel, cabinetRowLetter } from './cabinetGrid'

export interface MarkedSketchGrid {
  cols: number
  rows: number
  /** true — кубик. Ряд 0 сверху */
  occupied: boolean[][]
}

function cellText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim()
  }
  if (typeof value === 'object') {
    if ('text' in value && value.text != null) return String(value.text).trim()
    if ('result' in value && value.result != null) return String(value.result).trim()
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part: { text?: string }) => part.text ?? '').join('').trim()
    }
  }
  return ''
}

/** Таблица сетки: номер колонки сверху, буква ряда слева, в клетке метка кубика или пусто */
export async function downloadSketchGridXlsx(occupied: boolean[][]): Promise<void> {
  const rows = occupied.length
  const cols = occupied[0]?.length ?? 0
  if (rows < 1 || cols < 1) return

  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Сетка', {
    views: [{ showGridLines: true }],
  })

  sheet.getCell(1, 1).value = 'верх'
  sheet.getColumn(1).width = 8
  for (let col = 0; col < cols; col++) {
    sheet.getColumn(col + 2).width = 6
    const head = sheet.getCell(1, col + 2)
    head.value = col + 1
    head.alignment = { horizontal: 'center' }
    head.font = { bold: true, name: 'Arial', size: 10 }
  }

  for (let row = 0; row < rows; row++) {
    const letter = sheet.getCell(row + 2, 1)
    letter.value = cabinetRowLetter(row, rows)
    letter.font = { bold: true, name: 'Arial', size: 10 }
    letter.alignment = { horizontal: 'center' }
    for (let col = 0; col < cols; col++) {
      const cell = sheet.getCell(row + 2, col + 2)
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      }
      if (occupied[row][col]) {
        cell.value = cabinetLabel(row, col, rows)
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } }
        cell.font = { name: 'Arial', size: 9 }
      }
    }
    sheet.getRow(row + 2).height = 18
  }

  const note = sheet.getCell(1, cols + 3)
  note.value =
    'Кубик — любая пометка в клетке (номер уже стоит). Пустая клетка — нет кубика. Верх таблицы = верх экрана. Буквы рядов и номера колонок не удаляйте.'
  note.alignment = { wrapText: true }
  sheet.getColumn(cols + 3).width = 42

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `setka-${cols}x${rows}.xlsx`
  link.click()
  URL.revokeObjectURL(url)
}

/** Читает размеченную сетку. Пустая клетка внутри таблицы — нет кубика. */
export async function readSketchGridXlsx(file: File): Promise<MarkedSketchGrid> {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await file.arrayBuffer())
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error('В Excel нет листа')

  let cols = 0
  while (cellText(sheet.getCell(1, cols + 2).value) !== '' && cols < 80) cols++
  let rows = 0
  while (cellText(sheet.getCell(rows + 2, 1).value) !== '' && rows < 80) rows++

  if (cols >= 1 && rows >= 1) {
    const occupied = Array.from({ length: rows }, (_, row) =>
      Array.from({ length: cols }, (_, col) => cellText(sheet.getCell(row + 2, col + 2).value) !== ''),
    )
    return { cols, rows, occupied }
  }

  let minRow = Infinity
  let minCol = Infinity
  let maxRow = 0
  let maxCol = 0
  sheet.eachRow((row, rowNumber) => {
    row.eachCell((cell, colNumber) => {
      if (!cellText(cell.value)) return
      minRow = Math.min(minRow, rowNumber)
      minCol = Math.min(minCol, colNumber)
      maxRow = Math.max(maxRow, rowNumber)
      maxCol = Math.max(maxCol, colNumber)
    })
  })
  if (!Number.isFinite(minRow) || maxRow < minRow || maxCol < minCol) {
    throw new Error('В таблице нет размеченных кубиков')
  }
  const width = maxCol - minCol + 1
  const height = maxRow - minRow + 1
  const occupied = Array.from({ length: height }, (_, row) =>
    Array.from(
      { length: width },
      (_, col) => cellText(sheet.getCell(minRow + row, minCol + col).value) !== '',
    ),
  )
  return { cols: width, rows: height, occupied }
}
