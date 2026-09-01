import { PITCH_PRESETS } from './pitchPresets'

/** Эталон ширины кабинета в пикселях (3.9 small/big) */
export const PIXEL_MODULE_WIDE = 128

const MODULE_PX_DESKTOP = 56
const MODULE_PX_MOBILE = 40

export interface CabinetCellPx {
  w: number
  h: number
  pixelsWide: number
  pixelsHigh: number
}

/** Размер ячейки на схеме строго по соотношению пикселей кабинета */
export function cellPxFromPixels(
  pixelsWide: number,
  pixelsHigh: number,
  isMobile: boolean,
): CabinetCellPx {
  const modulePx = isMobile ? MODULE_PX_MOBILE : MODULE_PX_DESKTOP
  const scale = modulePx / PIXEL_MODULE_WIDE
  const pw = Math.max(1, Math.round(pixelsWide) || PIXEL_MODULE_WIDE)
  const ph = Math.max(1, Math.round(pixelsHigh) || PIXEL_MODULE_WIDE)
  return {
    w: Math.max(1, Math.round(pw * scale)),
    h: Math.max(1, Math.round(ph * scale)),
    pixelsWide: pw,
    pixelsHigh: ph,
  }
}

export function cellPxBatch(
  items: Array<{ pixelsWide: number; pixelsHigh: number }>,
  isMobile: boolean,
): CabinetCellPx[] {
  return items.map((i) => cellPxFromPixels(i.pixelsWide, i.pixelsHigh, isMobile))
}

/** Допуск относительной ошибки aspect ratio (округление px) */
export const ASPECT_TOLERANCE = 0.12

/** w/h должно совпадать с pixelsWide/pixelsHigh */
export function verifyCellAspect(
  cell: CabinetCellPx,
  tolerance = ASPECT_TOLERANCE,
): boolean {
  if (cell.pixelsHigh <= 0 || cell.h <= 0) return false
  const expected = cell.pixelsWide / cell.pixelsHigh
  const actual = cell.w / cell.h
  return Math.abs(actual - expected) / expected <= tolerance
}

/** Проверка всех пресетов — для verify-скрипта и регрессии */
export function verifyPresetAspects(isMobile = false): {
  ok: boolean
  failures: string[]
} {
  const failures: string[] = []
  for (const p of PITCH_PRESETS) {
    const cell = cellPxFromPixels(p.pixelsWide, p.pixelsHigh, isMobile)
    if (!verifyCellAspect(cell)) {
      failures.push(
        `${p.id}: ${cell.w}×${cell.h}px vs ${p.pixelsWide}×${p.pixelsHigh}px (ratio ${(cell.w / cell.h).toFixed(3)} vs ${(p.pixelsWide / p.pixelsHigh).toFixed(3)})`,
      )
    }
  }
  return { ok: failures.length === 0, failures }
}

/** Dev: предупреждение в консоль при нарушении пропорций */
export function warnIfAspectBroken(
  cells: CabinetCellPx[],
  context: string,
): void {
  if (import.meta.env.PROD) return
  for (const cell of cells) {
    if (!verifyCellAspect(cell)) {
      console.warn(
        `[cabinetCellSize] пропорции нарушены (${context}):`,
        cell,
        `ожид. ${cell.pixelsWide}:${cell.pixelsHigh}`,
      )
    }
  }
}
