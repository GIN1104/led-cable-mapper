import type { DataChain, ScreenConfig } from '../types'
import { buildNovaLctRegions } from './novaLctScr'

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function getNovaLctMapFilename(screenName: string, eventName?: string): string {
  const base = (eventName?.trim() || screenName || 'screen')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '-')
    .slice(0, 60)
  return `${base}-novalct-map.xlsx`
}

/**
 * Таблица Screen Connection для ручного ввода в NovaLCT (запасной вариант к .scr).
 */
export async function downloadNovaLctMappingXlsx(
  chains: DataChain[],
  config: ScreenConfig,
  eventName?: string,
): Promise<void> {
  const ExcelJS = (await import('exceljs')).default
  const regions = buildNovaLctRegions(chains, config)
  if (regions.length === 0) {
    throw new Error('Нет линий тикшорет для экспорта')
  }

  const book = new ExcelJS.Workbook()
  book.creator = 'LED Cable Mapper'
  const sheet = book.addWorksheet('NovaLCT')
  sheet.columns = [
    { header: 'Sender (0=первый)', key: 'sender', width: 16 },
    { header: 'Port (0=первый)', key: 'port', width: 14 },
    { header: 'Connect #', key: 'connect', width: 12 },
    { header: 'Col', key: 'col', width: 8 },
    { header: 'Row (0=верх)', key: 'row', width: 12 },
    { header: 'Label', key: 'label', width: 10 },
    { header: 'X px', key: 'x', width: 10 },
    { header: 'Y px', key: 'y', width: 10 },
    { header: 'W px', key: 'w', width: 10 },
    { header: 'H px', key: 'h', width: 10 },
  ]

  const labelAt = (col: number, row: number) => {
    const chain = chains.find(
      (c) => !c.isBackup && c.cabinets.some((cab) => cab.col === col && cab.row === row),
    )
    return chain?.cabinets.find((cab) => cab.col === col && cab.row === row)?.label ?? ''
  }

  for (const region of regions) {
    sheet.addRow({
      sender: region.senderIndex,
      port: region.portIndex,
      connect: region.connectIndex,
      col: region.col + 1,
      row: region.row,
      label: labelAt(region.col, region.row),
      x: region.x,
      y: region.y,
      w: region.width,
      h: region.height,
    })
  }

  const note = book.addWorksheet('Как ввести')
  note.getCell('A1').value =
    'Бинарный .scr из этого приложения пока отключён: неверная сборка роняет NovaLCT.'
  note.getCell('A2').value =
    'В NovaLCT: Screen Configuration → Screen Connection — разместите кубики по Col/Row и проводу по Port + Connect #.'
  note.getCell('A3').value =
    `Экран: ${config.name}, ${config.wallWidthM}×${config.wallHeightM} м, сетка ${config.cabinetsWide}×${config.cabinetsHigh}.`
  note.getCell('A4').value =
    'Port и Sender считаются с нуля (как в NovaLCT). Connect # — порядок в цепочке с нуля.'
  note.getCell('A5').value =
    'Если пришлёте рабочий .scr, сохранённый из вашей NovaLCT, можно будет сделать совместимый экспорт файла.'

  const buffer = await book.xlsx.writeBuffer()
  downloadBlob(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    getNovaLctMapFilename(config.name, eventName),
  )
}
