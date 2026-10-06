import { panelExportFilename, capturePanelPng } from './panelExport'
import type { TripBridge } from './tripBridge'

export interface SchemeUploadFile {
  filename: string
  blob: Blob
}

export interface TripUploadResult {
  ok: boolean
  uploaded?: number
  error?: string
}

/** data URL → Blob PNG */
export async function dataUrlToPngBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl)
  return response.blob()
}

/**
 * Снимает все видимые панели схем на странице (data + power).
 * Имена: panelExportFilename + индекс, если панелей несколько.
 */
export async function collectSchemePngFiles(eventName?: string): Promise<SchemeUploadFile[]> {
  const dataPanels = [
    ...document.querySelectorAll<HTMLElement>('[data-scheme-panel="data"]'),
  ]
  const powerPanels = [
    ...document.querySelectorAll<HTMLElement>('[data-scheme-panel="power"]'),
  ]
  if (dataPanels.length === 0 && powerPanels.length === 0) {
    throw new Error('Схемы не найдены на странице. Дождитесь расчёта сетки.')
  }

  const files: SchemeUploadFile[] = []
  const push = async (el: HTMLElement, mode: 'data' | 'power', index: number, total: number) => {
    const screenHint =
      el.getAttribute('data-screen-name')?.trim() ||
      (total > 1 ? `screen-${index + 1}` : 'screen')
    const dataUrl = await capturePanelPng(el, 2)
    const blob = await dataUrlToPngBlob(dataUrl)
    if (blob.type && !blob.type.includes('png') && blob.type !== 'application/octet-stream') {
      throw new Error('Ожидался PNG схемы')
    }
    files.push({
      filename: panelExportFilename(mode, screenHint, eventName),
      blob: blob.type === 'image/png' ? blob : new Blob([blob], { type: 'image/png' }),
    })
  }

  for (let i = 0; i < dataPanels.length; i++) {
    await push(dataPanels[i]!, 'data', i, dataPanels.length)
  }
  for (let i = 0; i < powerPanels.length; i++) {
    await push(powerPanels[i]!, 'power', i, powerPanels.length)
  }
  return files
}

/**
 * Отправка PNG в Apps Script выезда (multipart FormData).
 *
 * Основной контракт:
 *   action=uploadSchemeImages, trip_id, upload_token, meta (JSON), files (повторяющееся поле)
 *
 * Совместимость: дополнительно кладём file0, file1, … и filename0, … —
 * на случай, если GAS ждёт индексированные поля вместо files[].
 */
export async function uploadSchemeImagesToTrip(
  bridge: TripBridge,
  files: SchemeUploadFile[],
): Promise<TripUploadResult> {
  if (!bridge.uploadUrl || !bridge.uploadToken || !bridge.tripId) {
    return { ok: false, error: 'Нет данных выезда (upload_url / token / trip_id)' }
  }
  if (files.length === 0) {
    return { ok: false, error: 'Нет файлов для отправки' }
  }

  const form = new FormData()
  form.append('action', 'uploadSchemeImages')
  form.append('trip_id', bridge.tripId)
  form.append('upload_token', bridge.uploadToken)
  form.append(
    'meta',
    JSON.stringify({
      source: 'led-cable-mapper',
      title: bridge.title || undefined,
      types: bridge.types || undefined,
    }),
  )

  files.forEach((file, index) => {
    const png =
      file.blob.type === 'image/png'
        ? file.blob
        : new Blob([file.blob], { type: 'image/png' })
    form.append('files', png, file.filename)
    form.append(`file${index}`, png, file.filename)
    form.append(`filename${index}`, file.filename)
  })

  let response: Response
  try {
    response = await fetch(bridge.uploadUrl, {
      method: 'POST',
      body: form,
      credentials: 'omit',
    })
  } catch {
    return {
      ok: false,
      error:
        'Сеть или CORS: не удалось достучаться до upload_url. Проверьте Apps Script (доступ «Anyone») и CORS.',
    }
  }

  const text = await response.text()
  let parsed: TripUploadResult | null = null
  try {
    parsed = JSON.parse(text) as TripUploadResult
  } catch {
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}: ${text.slice(0, 200)}` }
    }
    return { ok: true, uploaded: files.length }
  }

  if (parsed && typeof parsed.ok === 'boolean') {
    return {
      ok: parsed.ok,
      uploaded: parsed.uploaded,
      error: parsed.ok ? undefined : parsed.error || 'Ошибка загрузки',
    }
  }
  if (!response.ok) {
    return { ok: false, error: `HTTP ${response.status}` }
  }
  return { ok: true, uploaded: files.length }
}

/** Режет список на пачки по maxFiles (лимит GAS ≈ 5). */
export function chunkFiles<T>(items: T[], maxFiles = 5): T[][] {
  if (maxFiles < 1) return [items]
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += maxFiles) {
    chunks.push(items.slice(i, i + maxFiles))
  }
  return chunks
}
