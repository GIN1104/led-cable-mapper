import type { ControllerModel, RefreshRate } from '../types'
import {
  MAX_PIXELS_PER_DATA_PORT_50HZ,
  MAX_PIXELS_PER_DATA_PORT_60HZ,
} from './constants'

/**
 * Лимиты входа и выхода аппарата.
 * Герцы только 50 (обычно) и 60 (реже). Ниже 50 Гц не предлагаем.
 * Цифры — из паспортов NovaStar: потолок пикселей, ширина и высота.
 * На 50 Гц пиксельный бюджет входа выше на 60/50, ширина и высота те же.
 */
interface DeviceLimits {
  model: ControllerModel
  name: string
  ports: number
  maxOutputPixels: number
  maxOutputWidth: number
  maxOutputHeight: number
  maxInputWidth: number
  maxInputHeight: number
  /** Пиксели входа на 60 Гц (потолок pixel clock). */
  maxInputPixels60: number
  suggestInput: { width: number; height: number }
}

const DEVICES: DeviceLimits[] = [
  {
    model: 'TB60',
    name: 'TB60',
    ports: 4,
    maxOutputPixels: 2_300_000,
    maxOutputWidth: 4096,
    maxOutputHeight: 4096,
    maxInputWidth: 4096,
    maxInputHeight: 4096,
    maxInputPixels60: 1920 * 1200,
    suggestInput: { width: 1920, height: 1080 },
  },
  {
    model: 'Linsn',
    name: 'Linsn',
    ports: 2,
    maxOutputPixels: 1_300_000,
    maxOutputWidth: 1920,
    maxOutputHeight: 1080,
    maxInputWidth: 1920,
    maxInputHeight: 1080,
    maxInputPixels60: 1920 * 1080,
    suggestInput: { width: 1920, height: 1080 },
  },
  {
    model: 'NovaStar 600',
    name: 'MCTRL600',
    ports: 4,
    maxOutputPixels: 2_300_000,
    maxOutputWidth: 3840,
    maxOutputHeight: 1920,
    maxInputWidth: 3840,
    maxInputHeight: 3840,
    maxInputPixels60: 1920 * 1200,
    suggestInput: { width: 1920, height: 1080 },
  },
  {
    model: 'Generic 1G Controller',
    name: '1G-порт',
    ports: 1,
    maxOutputPixels: MAX_PIXELS_PER_DATA_PORT_50HZ,
    maxOutputWidth: 4096,
    maxOutputHeight: 4096,
    maxInputWidth: 4096,
    maxInputHeight: 4096,
    maxInputPixels60: MAX_PIXELS_PER_DATA_PORT_60HZ,
    suggestInput: { width: 1920, height: 1080 },
  },
  {
    model: 'NovaStar VX1000',
    name: 'VX1000',
    ports: 10,
    maxOutputPixels: 6_500_000,
    maxOutputWidth: 10_240,
    maxOutputHeight: 8192,
    maxInputWidth: 4092,
    maxInputHeight: 3981,
    maxInputPixels60: 4092 * 1136,
    suggestInput: { width: 3840, height: 1080 },
  },
  {
    model: 'NovaStar VX2000',
    name: 'VX2000',
    ports: 20,
    maxOutputPixels: 13_000_000,
    maxOutputWidth: 16_384,
    maxOutputHeight: 8192,
    maxInputWidth: 8192,
    maxInputHeight: 8188,
    maxInputPixels60: 4096 * 2160,
    suggestInput: { width: 3840, height: 2160 },
  },
  {
    model: 'NovaStar MCTRL4K',
    name: 'MCTRL4K',
    ports: 16,
    maxOutputPixels: 4096 * 2160,
    maxOutputWidth: 7680,
    maxOutputHeight: 7680,
    maxInputWidth: 7680,
    maxInputHeight: 7680,
    maxInputPixels60: 4096 * 2160,
    suggestInput: { width: 3840, height: 2160 },
  },
  {
    model: 'NovaStar H2',
    name: 'H2',
    ports: 20,
    maxOutputPixels: 13_000_000,
    maxOutputWidth: 16_384,
    maxOutputHeight: 8192,
    maxInputWidth: 8192,
    maxInputHeight: 8188,
    maxInputPixels60: 4096 * 2160,
    suggestInput: { width: 3840, height: 2160 },
  },
]

const LADDER: ControllerModel[] = [
  'TB60',
  'Linsn',
  'NovaStar 600',
  'NovaStar VX1000',
  'NovaStar VX2000',
  'NovaStar MCTRL4K',
  'NovaStar H2',
]

export interface ControllerResolutionAlert {
  /** Что не влезает: выход, вход или оба */
  outputText: string | null
  inputText: string | null
  /** Что поставить: герцы, источник или другой аппарат */
  suggestion: string
}

interface Fit {
  pixels: number
  width: number
  height: number
  /** Для мозаики: высота одного аппарата, ширина уже умножена. */
  singleWidth: number
  singleHeight: number
}

function deviceOf(model: ControllerModel): DeviceLimits {
  return DEVICES.find((item) => item.model === model) ?? DEVICES[3]!
}

function perPort(hz: RefreshRate): number {
  return hz === 50 ? MAX_PIXELS_PER_DATA_PORT_50HZ : MAX_PIXELS_PER_DATA_PORT_60HZ
}

function outputFit(device: DeviceLimits, hz: RefreshRate, units: number): Fit {
  const pixels = Math.min(device.maxOutputPixels, device.ports * perPort(hz)) * units
  return {
    pixels,
    width: device.maxOutputWidth * units,
    height: device.maxOutputHeight * units,
    singleWidth: device.maxOutputWidth,
    singleHeight: device.maxOutputHeight,
  }
}

function inputFit(device: DeviceLimits, hz: RefreshRate): Fit {
  const pixels =
    hz === 50
      ? Math.round((device.maxInputPixels60 * 60) / 50)
      : device.maxInputPixels60
  return {
    pixels,
    width: device.maxInputWidth,
    height: device.maxInputHeight,
    singleWidth: device.maxInputWidth,
    singleHeight: device.maxInputHeight,
  }
}

function fitsOutput(wide: number, high: number, cap: Fit): boolean {
  if (wide * high > cap.pixels) return false
  const sideBySide = wide <= cap.width && high <= cap.singleHeight
  const stacked = high <= cap.height && wide <= cap.singleWidth
  return sideBySide || stacked
}

function fitsInput(wide: number, high: number, cap: Fit): boolean {
  return wide <= cap.width && high <= cap.height && wide * high <= cap.pixels
}

function pixelsLabel(pixels: number): string {
  if (pixels >= 1_000_000) return `${(pixels / 1_000_000).toFixed(1)} млн px`
  return `${Math.round(pixels / 1000)} тыс. px`
}

function size(wide: number, high: number): string {
  return `${wide.toLocaleString()}×${high.toLocaleString()}`
}

interface Setup {
  model: ControllerModel
  units: number
  hz: RefreshRate
}

function unitsFor(model: ControllerModel, dualVx1000: boolean): number {
  return model === 'NovaStar VX1000' && dualVx1000 ? 2 : 1
}

function labelOf(model: ControllerModel, units: number): string {
  const name = deviceOf(model).name
  return units > 1 ? `${units}× ${name}` : name
}

function fitsSetup(wide: number, high: number, setup: Setup): { output: boolean; input: boolean } {
  const device = deviceOf(setup.model)
  const output = fitsOutput(wide, high, outputFit(device, setup.hz, setup.units))
  if (setup.units <= 1) {
    return { output, input: fitsInput(wide, high, inputFit(device, setup.hz)) }
  }
  const side = fitsInput(Math.ceil(wide / setup.units), high, inputFit(device, setup.hz))
  const stacked = fitsInput(wide, Math.ceil(high / setup.units), inputFit(device, setup.hz))
  return { output, input: side || stacked }
}

function describeSuggestion(wide: number, high: number, setup: Setup): string {
  const device = deviceOf(setup.model)
  const name = labelOf(setup.model, setup.units)
  const source = `${device.suggestInput.width}×${device.suggestInput.height}`
  const samePixels = wide * high <= inputFit(device, 50).pixels
  const sameFrame = wide <= device.maxInputWidth && high <= device.maxInputHeight
  if (samePixels && sameFrame && setup.units <= 1) {
    return `Используйте ${name} @ 50 Гц, источник ${size(wide, high)}. 60 Гц реже, ниже 50 Гц не ставим.`
  }
  if (setup.units > 1) {
    return `Используйте ${name} @ 50 Гц: экран делится между аппаратами. На каждый вход не больше ${source} @ 50 Гц. Ниже 50 Гц не ставим.`
  }
  return `Используйте ${name} @ 50 Гц. Источник не больше ${source} @ 50 Гц. Ниже 50 Гц не ставим.`
}

/**
 * Красный алерт, если разрешение входа или выхода больше аппарата.
 * Сначала предлагает 50 Гц на том же аппарате, потом другой контроллер.
 */
export function assessControllerResolution(args: {
  model: ControllerModel
  dualVx1000?: boolean
  refreshRate: RefreshRate
  pixelsWide: number
  pixelsHigh: number
}): ControllerResolutionAlert | null {
  const wide = Math.round(args.pixelsWide)
  const high = Math.round(args.pixelsHigh)
  if (wide <= 0 || high <= 0) return null

  const model = args.model
  const dual = Boolean(args.dualVx1000)
  const hz = args.refreshRate
  const units = unitsFor(model, dual)
  const device = deviceOf(model)
  const name = labelOf(model, units)
  const now = fitsSetup(wide, high, { model, units, hz })
  if (now.output && now.input) return null

  const outCap = outputFit(device, hz, units)
  const inCap = inputFit(device, hz)
  const pixels = wide * high

  const outputText = now.output
    ? null
    : `Выход ${size(wide, high)} (${pixelsLabel(pixels)}) @ ${hz} Гц больше, чем ${name}: до ${pixelsLabel(outCap.pixels)}, ширина до ${outCap.singleWidth.toLocaleString()}, высота до ${outCap.singleHeight.toLocaleString()}.`

  const inputText = now.input
    ? null
    : `Вход ${size(wide, high)} @ ${hz} Гц больше, чем берёт ${name}: до ${size(inCap.width, inCap.height)} и ${pixelsLabel(inCap.pixels)}.`

  if (now.output) {
    const at50 = fitsInput(wide, high, inputFit(device, 50))
    const source = `${device.suggestInput.width}×${device.suggestInput.height}`
    const suggestion = at50
      ? `Поставьте 50 Гц — источник ${size(wide, high)} на 50 Гц входит, на 60 Гц нет. Ниже 50 Гц не ставим.`
      : `Экран на выход входит. На вход подайте ${source} @ 50 Гц, ${name} растянет картинку. Ниже 50 Гц не ставим.`
    return { outputText: null, inputText, suggestion }
  }

  const current: Setup = { model, units, hz }
  const candidates: Setup[] = []
  const push = (setup: Setup) => {
    if (
      setup.model === current.model &&
      setup.units === current.units &&
      setup.hz === current.hz
    ) {
      return
    }
    if (candidates.some((item) => item.model === setup.model && item.units === setup.units && item.hz === setup.hz)) {
      return
    }
    candidates.push(setup)
  }
  if (hz === 60) push({ model, units, hz: 50 })
  for (const next of LADDER) {
    push({ model: next, units: 1, hz: 50 })
  }
  push({ model: 'NovaStar VX1000', units: 2, hz: 50 })

  let chosen: Setup | null = null
  for (const setup of candidates) {
    if (fitsSetup(wide, high, setup).output) {
      chosen = setup
      break
    }
  }

  const suggestion = chosen
    ? describeSuggestion(wide, high, chosen)
    : `Даже H2 и VX2000 на 50 Гц не берут ${size(wide, high)}. Уменьшите экран или разбейте на два аппарата. Ниже 50 Гц не ставим.`

  return { outputText, inputText, suggestion }
}
