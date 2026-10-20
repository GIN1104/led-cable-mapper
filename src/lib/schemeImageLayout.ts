/** Ширина четырёх колонок списка, чтобы схема не вылезала за таблицу */
export const SCHEME_SHEET_MAX_WIDTH = 980
export const SCHEME_ROW_PX = 20

/** Размер картинки на листе: экранные пиксели, не шире таблицы */
export function schemeDisplaySize(
  naturalWidth: number,
  naturalHeight: number,
  captureRatio = 3,
): { width: number; height: number } {
  const ratio = Math.max(1, captureRatio)
  let width = naturalWidth / ratio
  let height = naturalHeight / ratio
  if (width > SCHEME_SHEET_MAX_WIDTH) {
    const scale = SCHEME_SHEET_MAX_WIDTH / width
    width = SCHEME_SHEET_MAX_WIDTH
    height *= scale
  }
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  }
}

/** Сколько строк занять, чтобы следующая схема началась строго ниже */
export function schemeImageSpan(
  startRow: number,
  heightPx: number,
): { imageStart: number; rows: number; nextRow: number } {
  const rows = Math.max(1, Math.ceil(heightPx / SCHEME_ROW_PX))
  const imageStart = startRow + 1
  return { imageStart, rows, nextRow: imageStart + rows }
}
