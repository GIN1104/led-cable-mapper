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

/** Один PNG-файл схемы из DOM-элемента панели */
export async function buildSchemeFileFromElement(
  el: HTMLElement,
  mode: 'data' | 'power',
  screenName: string,
  eventName?: string,
): Promise<SchemeUploadFile> {
  // pixelRatio 3 — как Excel/Drive: SVG на экране, в файл уходит растровый PNG
  const dataUrl = await capturePanelPng(el, 3)
  if (!dataUrl.startsWith('data:image/png')) {
    throw new Error('Снимок схемы не в формате PNG')
  }
  const blob = await dataUrlToPngBlob(dataUrl)
  const png =
    blob.type === 'image/png' ? blob : new Blob([blob], { type: 'image/png' })
  return {
    filename: panelExportFilename(mode, screenName || 'screen', eventName),
    blob: png,
  }
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
    // SVG в DOM → PNG data URL (image/png), не сырой SVG
    const dataUrl = await capturePanelPng(el, 3)
    const blob = await dataUrlToPngBlob(dataUrl)
    if (blob.type && !blob.type.includes('png') && blob.type !== 'application/octet-stream') {
      throw new Error('Ожидался PNG схемы')
    }
    if (!dataUrl.startsWith('data:image/png')) {
      throw new Error('Снимок схемы не в формате PNG')
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
 * URL для POST: auth-поля дублируем в query.
 * У Apps Script multipart часто не попадает в e.parameter — тогда сервер отвечает unauthorized.
 */
function buildUploadRequestUrl(bridge: TripBridge): string {
  const url = new URL(bridge.uploadUrl)
  url.searchParams.set('action', 'uploadSchemeImages')
  url.searchParams.set('trip_id', bridge.tripId)
  url.searchParams.set('upload_token', bridge.uploadToken)
  url.searchParams.set('upload_transport', bridge.uploadTransport || 'form')
  return url.toString()
}

function formatUploadError(raw: string, fallback: string): string {
  const text = raw.trim()
  if (!text) return fallback
  const lower = text.toLowerCase()
  if (lower.includes('unauthorized') || lower === 'unauthorized') {
    return (
      'unauthorized — сервер отклонил upload_token. ' +
      'Откройте mapper заново по свежей ссылке из бота (токен одноразовый/сгорает) ' +
      'и сразу нажмите «Отправить».'
    )
  }
  return text.length > 280 ? `${text.slice(0, 280)}…` : text
}

/**
 * Отправка PNG в Apps Script выезда (multipart FormData).
 *
 * Контракт:
 *   action=uploadSchemeImages, trip_id, upload_token, meta (JSON), files
 * Auth дублируется в query + FormData (без кастомных headers — иначе CORS preflight к GAS).
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

  const metaJson = JSON.stringify({
    source: 'led-cable-mapper',
    title: bridge.title || undefined,
    types: bridge.types || undefined,
  })

  const form = new FormData()
  form.append('action', 'uploadSchemeImages')
  form.append('trip_id', bridge.tripId)
  form.append('upload_token', bridge.uploadToken)
  form.append('upload_transport', bridge.uploadTransport || 'form')
  form.append('meta', metaJson)

  files.forEach((file, index) => {
    const png =
      file.blob.type === 'image/png'
        ? file.blob
        : new Blob([file.blob], { type: 'image/png' })
    form.append('files', png, file.filename)
    form.append(`file${index}`, png, file.filename)
    form.append(`filename${index}`, file.filename)
  })

  // Query несёт auth на случай, если GAS не разобрал multipart text-поля.
  const requestUrl = buildUploadRequestUrl(bridge)

  let response: Response
  try {
    response = await fetch(requestUrl, {
      method: 'POST',
      body: form,
      credentials: 'omit',
      mode: 'cors',
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
      return {
        ok: false,
        error: formatUploadError(text, `HTTP ${response.status}`),
      }
    }
    // Иногда GAS отдаёт plain "unauthorized"
    if (/unauthorized/i.test(text)) {
      return { ok: false, error: formatUploadError(text, 'unauthorized') }
    }
    return { ok: true, uploaded: files.length }
  }

  if (parsed && typeof parsed.ok === 'boolean') {
    return {
      ok: parsed.ok,
      uploaded: parsed.uploaded,
      error: parsed.ok
        ? undefined
        : formatUploadError(parsed.error || '', 'Ошибка загрузки'),
    }
  }
  if (!response.ok) {
    return { ok: false, error: formatUploadError(text, `HTTP ${response.status}`) }
  }
  if (parsed && typeof (parsed as { error?: string }).error === 'string') {
    return {
      ok: false,
      error: formatUploadError((parsed as { error: string }).error, 'Ошибка загрузки'),
    }
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
