/**
 * Сборка бинарного NovaLCT .scr (DSCI) по образцу реальной Screen Connection.
 * Формат сверен с файлом, сохранённым из NovaLCT (версия ScreenInfo 1006).
 */
import type { DataChain, ScreenConfig } from '../types'

/** Кабинет в карте Screen Connection NovaLCT (.scr) */
export interface NovaLctCabinetRegion {
  senderIndex: number
  portIndex: number
  connectIndex: number
  col: number
  row: number
  x: number
  y: number
  width: number
  height: number
}

const SENDER_EMPTY = 255
const DSCI_HEADER = 54
/** В рабочих .scr длина DVI-секции всегда 128 (8 байт данных + паддинг) */
const DVI_SECTION_SIZE = 128
const SCREEN_HEADER = 133
const ADJUST_HEADER = 133
const ADJUST_PARAM = 40
/** RegionInfo: Sender+Port+Connect+X+Y+XIn+YIn+W+H+DVIIndex = 17 */
const REGION_SIZE = 17
const STANDARD_HEADER = 10
/** Хвост после регионов, как в NovaLCT 1006 (иначе длина/парсер плывут) */
const STANDARD_TRAILER = new Uint8Array([
  0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02,
])
const SCREEN_VERSION = 1006
/** Индекс входа DVI/видео в RegionInfo у рабочего образца = 1 */
const REGION_DVI_INDEX = 1
const DVI_EXTENDS_JSON = '[{"si":0,"x1":0,"y1":0,"x2":0,"y2":0,"x3":0,"y3":0,"x4":0,"y4":0}]'

/** Простая сумма CRC16, как в @novastar/screen */
function crc16(data: Uint8Array, initial = 0): number {
  let acc = initial & 0xffff
  for (let i = 0; i < data.length; i++) acc = (acc + data[i]!) & 0xffff
  return acc
}

function writeU16LE(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value & 0xffff, true)
}

function writeU32LE(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true)
}

function writeAscii(buf: Uint8Array, offset: number, text: string, length: number) {
  for (let i = 0; i < length; i++) {
    buf[offset + i] = i < text.length ? text.charCodeAt(i) & 0xff : 0
  }
}

function mainChains(chains: DataChain[]): DataChain[] {
  return chains
    .filter((chain) => !chain.isBackup && chain.cabinets.length > 0)
    .slice()
    .sort((a, b) => a.portNumber - b.portNumber)
}

function pixelGrid(chains: DataChain[], config: ScreenConfig) {
  const colW = new Array<number>(config.cabinetsWide).fill(0)
  const rowH = new Array<number>(config.cabinetsHigh).fill(0)
  for (const chain of chains) {
    if (chain.isBackup) continue
    for (const cab of chain.cabinets) {
      colW[cab.col] = Math.max(colW[cab.col] ?? 0, cab.pixelsWide)
      rowH[cab.row] = Math.max(rowH[cab.row] ?? 0, cab.pixelsHigh)
    }
  }
  const fallbackW = colW.find((w) => w > 0) ?? 128
  const fallbackH = rowH.find((h) => h > 0) ?? 128
  for (let col = 0; col < config.cabinetsWide; col++) {
    if (!colW[col]) colW[col] = fallbackW
  }
  for (let row = 0; row < config.cabinetsHigh; row++) {
    if (!rowH[row]) rowH[row] = fallbackH
  }
  const colX = new Array<number>(config.cabinetsWide).fill(0)
  const rowY = new Array<number>(config.cabinetsHigh).fill(0)
  for (let col = 1; col < config.cabinetsWide; col++) {
    colX[col] = (colX[col - 1] ?? 0) + (colW[col - 1] ?? 0)
  }
  for (let row = 1; row < config.cabinetsHigh; row++) {
    rowY[row] = (rowY[row - 1] ?? 0) + (rowH[row - 1] ?? 0)
  }
  return { colX, rowY, colW, rowH }
}

/** Пиксельные координаты: ряд 0 сверху */
export function buildNovaLctRegions(
  chains: DataChain[],
  config: ScreenConfig,
): NovaLctCabinetRegion[] {
  const { colX, rowY } = pixelGrid(chains, config)
  const regions: NovaLctCabinetRegion[] = []
  for (const chain of mainChains(chains)) {
    const senderIndex = Math.max(0, (chain.controllerId ?? 1) - 1)
    const portIndex = Math.max(0, (chain.localNumber ?? chain.portNumber) - 1)
    chain.cabinets.forEach((cab, connectIndex) => {
      regions.push({
        senderIndex,
        portIndex,
        connectIndex,
        col: cab.col,
        row: cab.row,
        x: colX[cab.col] ?? 0,
        y: rowY[cab.row] ?? 0,
        width: cab.pixelsWide,
        height: cab.pixelsHigh,
      })
    })
  }
  return regions
}

function writeRegion(
  view: DataView,
  offset: number,
  region: {
    senderIndex: number
    portIndex: number
    connectIndex: number
    x: number
    y: number
    /** Индекс колонки кабинета на стене (не пиксели) */
    xInPort: number
    /** Индекс ряда кабинета на стене (не пиксели) */
    yInPort: number
    width: number
    height: number
  },
) {
  view.setUint8(offset, region.senderIndex & 0xff)
  view.setUint8(offset + 1, region.portIndex & 0xff)
  writeU16LE(view, offset + 2, region.connectIndex)
  writeU16LE(view, offset + 4, region.x)
  writeU16LE(view, offset + 6, region.y)
  writeU16LE(view, offset + 8, region.xInPort)
  writeU16LE(view, offset + 10, region.yInPort)
  writeU16LE(view, offset + 12, region.width)
  writeU16LE(view, offset + 14, region.height)
  view.setUint8(offset + 16, REGION_DVI_INDEX)
}

/**
 * StandardType: регионы в порядке колонка→ряд (как в рабочем .scr NovaLCT).
 * XInPort/YInPort = индексы ячейки, не пиксельные смещения.
 */
function encodeStandardScreen(chains: DataChain[], config: ScreenConfig): Uint8Array {
  const { colX, rowY, colW, rowH } = pixelGrid(chains, config)
  const byCell = new Map<string, NovaLctCabinetRegion>()
  for (const region of buildNovaLctRegions(chains, config)) {
    byCell.set(`${region.col},${region.row}`, region)
  }

  const cols = config.cabinetsWide
  const rows = config.cabinetsHigh
  const buf = new Uint8Array(STANDARD_HEADER + cols * rows * REGION_SIZE + STANDARD_TRAILER.length)
  const view = new DataView(buf.buffer)
  view.setUint8(0, 1) // StandardType
  view.setUint8(1, 0) // VirtualMode Disable
  writeU16LE(view, 2, 0)
  writeU16LE(view, 4, 0)
  writeU16LE(view, 6, cols)
  writeU16LE(view, 8, rows)
  let offset = STANDARD_HEADER
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const live = byCell.get(`${col},${row}`)
      const x = colX[col] ?? 0
      const y = rowY[row] ?? 0
      const w = colW[col] ?? 128
      const h = rowH[row] ?? 128
      if (live) {
        writeRegion(view, offset, {
          senderIndex: live.senderIndex,
          portIndex: live.portIndex,
          connectIndex: live.connectIndex,
          x,
          y,
          xInPort: col,
          yInPort: row,
          width: live.width || w,
          height: live.height || h,
        })
      } else {
        writeRegion(view, offset, {
          senderIndex: SENDER_EMPTY,
          portIndex: 0,
          connectIndex: 0,
          x,
          y,
          xInPort: col,
          yInPort: row,
          width: w,
          height: h,
        })
      }
      offset += REGION_SIZE
    }
  }
  buf.set(STANDARD_TRAILER, offset)
  return buf
}

function encodeDviInfo(): Uint8Array {
  const buf = new Uint8Array(DVI_SECTION_SIZE)
  const view = new DataView(buf.buffer)
  writeU16LE(view, 0, 1001)
  view.setUint8(4, 1) // DviPortCols
  view.setUint8(5, 1) // DviPortRows
  view.setUint8(6, 0) // GraphicsWidth (в бинарнике UInt8, в образце 0)
  view.setUint8(7, 0) // GraphicsHeight
  writeU16LE(view, 2, crc16(buf.subarray(4), 0))
  return buf
}

/** Adjust: масштабы 1/1, как в рабочем файле NovaLCT */
function encodeAdjustInfo(_screenName: string): Uint8Array {
  const buf = new Uint8Array(ADJUST_HEADER + ADJUST_PARAM)
  const view = new DataView(buf.buffer)
  writeU16LE(view, 0, 1002)
  view.setUint8(132, 1)
  const p = ADJUST_HEADER
  view.setUint8(p, 0) // ScreenXZoomType
  view.setUint8(p + 1, 1) // ScreenXScale
  view.setUint8(p + 2, 0) // ScreenYZoomType
  view.setUint8(p + 3, 1) // ScreenYScale
  view.setUint8(p + 4, 0) // VirtualMap
  // ScreenName 20 байт — нули, как в образце
  view.setUint8(p + 25, 0) // ThreeD
  return buf
}

function encodeScreenInfo(screenBlob: Uint8Array): Uint8Array {
  const jsonBytes = new TextEncoder().encode(DVI_EXTENDS_JSON)
  const extendsSize = 2 + jsonBytes.length
  const screenDataPos = SCREEN_HEADER + 4
  const dviExtendsPos = screenDataPos + screenBlob.length
  const size = dviExtendsPos + extendsSize
  const buf = new Uint8Array(size)
  const view = new DataView(buf.buffer)
  writeU16LE(view, 0, SCREEN_VERSION)
  writeU32LE(view, 28, dviExtendsPos)
  view.setUint8(132, 1)
  writeU32LE(view, 133, screenBlob.length)
  buf.set(screenBlob, screenDataPos)
  writeU16LE(view, dviExtendsPos, jsonBytes.length)
  buf.set(jsonBytes, dviExtendsPos + 2)
  writeU16LE(view, 2, crc16(buf.subarray(4), 0))
  return buf
}

/**
 * Файл Screen Connection NovaLCT (*.scr).
 * Всегда StandardType — формат совпадает с файлами, которые открывает текущая NovaLCT.
 */
export function encodeNovaLctScr(chains: DataChain[], config: ScreenConfig): Uint8Array {
  const main = mainChains(chains)
  if (!main.length) {
    throw new Error('Нет линий тикшорет для экспорта в NovaLCT')
  }
  const screenBlob = encodeStandardScreen(chains, config)
  const dvi = encodeDviInfo()
  const screenInfo = encodeScreenInfo(screenBlob)
  const adjust = encodeAdjustInfo(config.name || 'Screen')
  const total = DSCI_HEADER + dvi.length + screenInfo.length + adjust.length
  const buf = new Uint8Array(total)
  const view = new DataView(buf.buffer)
  writeAscii(buf, 0, 'DSCI', 4)
  writeU32LE(view, 6, dvi.length)
  writeU32LE(view, 10, screenInfo.length)
  writeU16LE(view, 14, adjust.length)
  buf.set(dvi, DSCI_HEADER)
  buf.set(screenInfo, DSCI_HEADER + dvi.length)
  buf.set(adjust, DSCI_HEADER + dvi.length + screenInfo.length)
  writeU16LE(view, 4, crc16(buf.subarray(6, total - adjust.length), 0))
  return buf
}

export function getNovaLctScrFilename(screenName: string, eventName?: string): string {
  const base = (eventName?.trim() || screenName || 'screen')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '-')
    .slice(0, 60)
  return `${base}-tikshoret.scr`
}

/** Скачать .scr: NovaLCT → Screen Configuration → Screen Connection → Open */
export function downloadNovaLctScr(
  chains: DataChain[],
  config: ScreenConfig,
  eventName?: string,
): void {
  const bytes = encodeNovaLctScr(chains, config)
  const blob = new Blob([bytes], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = getNovaLctScrFilename(config.name, eventName)
  anchor.click()
  URL.revokeObjectURL(url)
}
