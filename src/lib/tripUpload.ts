import { panelExportFilename, capturePanelPng } from './panelExport'
import type { TripBridge } from './tripBridge'

export interface SchemeUploadFile {
  filename: string
  blob: Blob
  /** PNG без префикса data:image/png;base64, — если уже известен */
  base64?: string
}

export interface TripUploadResult {
  ok: boolean
  uploaded?: number
  error?: string
}

interface SchemeFilePayload {
  name: string
  mimeType: string
  base64: string
}

interface SchemeUploadPayload {
  action: 'uploadSchemeImages'
  trip_id: string
  upload_token: string
  files: SchemeFilePayload[]
  meta: {
    source: string
    title?: string
    types?: string
  }
}

const UPLOAD_TIMEOUT_MS = 120_000

/** data URL → Blob PNG */
export async function dataUrlToPngBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl)
  return response.blob()
}

function stripPngDataUrlPrefix(dataUrl: string): string {
  const marker = 'base64,'
  const idx = dataUrl.indexOf(marker)
  if (idx === -1) return dataUrl
  return dataUrl.slice(idx + marker.length)
}

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsDataURL(blob)
  })
  return stripPngDataUrlPrefix(dataUrl)
}

function makeNonce(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function isAllowedBridgeOrigin(origin: string): boolean {
  if (!origin) return false
  if (typeof window !== 'undefined' && origin === window.location.origin) return true
  try {
    const host = new URL(origin).hostname
    return (
      host === 'script.google.com' ||
      host === 'script.googleusercontent.com' ||
      host.endsWith('.googleusercontent.com') ||
      host.endsWith('.google.com')
    )
  } catch {
    return false
  }
}

function formatUploadError(raw: string, fallback: string): string {
  const text = raw.trim()
  if (!text) return fallback
  const lower = text.toLowerCase()
  if (lower.includes('unauthorized') || lower === 'unauthorized') {
    return (
      'unauthorized — сервер отклонил upload_token. ' +
      'Откройте mapper заново по свежей ссылке из бота и сразу нажмите «Отправить».'
    )
  }
  return text.length > 280 ? `${text.slice(0, 280)}…` : text
}

/**
 * Мост к Apps Script: скрытая form + scheme_payload / scheme_nonce / clientOrigin,
 * ответ через postMessage (как postSchemeForm из bridge/mapper-upload.js).
 */
export function postSchemeForm(
  uploadUrl: string,
  payload: SchemeUploadPayload,
): Promise<TripUploadResult> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return Promise.resolve({ ok: false, error: 'postSchemeForm только в браузере' })
  }

  return new Promise((resolve) => {
    const nonce = makeNonce()
    const frameName = `led-trip-upload-${nonce}`
    let settled = false

    const iframe = document.createElement('iframe')
    iframe.name = frameName
    iframe.setAttribute('aria-hidden', 'true')
    iframe.style.cssText =
      'position:absolute;width:0;height:0;border:0;clip:rect(0,0,0,0);visibility:hidden'

    const form = document.createElement('form')
    form.method = 'POST'
    form.action = uploadUrl
    form.target = frameName
    form.acceptCharset = 'UTF-8'
    form.style.display = 'none'
    form.enctype = 'application/x-www-form-urlencoded'

    const addField = (name: string, value: string) => {
      const input = document.createElement('input')
      input.type = 'hidden'
      input.name = name
      input.value = value
      form.appendChild(input)
    }

    addField('scheme_payload', JSON.stringify(payload))
    addField('scheme_nonce', nonce)
    addField('clientOrigin', window.location.origin)

    const cleanup = () => {
      window.removeEventListener('message', onMessage)
      window.clearTimeout(timer)
      form.remove()
      iframe.remove()
    }

    const finish = (result: TripUploadResult) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    const onMessage = (event: MessageEvent) => {
      if (!isAllowedBridgeOrigin(event.origin)) return

      let data: unknown = event.data
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data) as unknown
        } catch {
          return
        }
      }
      if (!data || typeof data !== 'object') return

      const record = data as Record<string, unknown>
      const msgNonce =
        (typeof record.scheme_nonce === 'string' && record.scheme_nonce) ||
        (typeof record.nonce === 'string' && record.nonce) ||
        (typeof record.clientNonce === 'string' && record.clientNonce) ||
        ''
      if (msgNonce !== nonce) return

      const nested =
        record.result && typeof record.result === 'object'
          ? (record.result as Record<string, unknown>)
          : record.payload && typeof record.payload === 'object'
            ? (record.payload as Record<string, unknown>)
            : record

      if (typeof nested.ok === 'boolean') {
        finish({
          ok: nested.ok,
          uploaded: typeof nested.uploaded === 'number' ? nested.uploaded : undefined,
          error: nested.ok
            ? undefined
            : formatUploadError(String(nested.error ?? ''), 'Ошибка загрузки'),
        })
        return
      }

      if (typeof nested.error === 'string') {
        finish({ ok: false, error: formatUploadError(nested.error, 'Ошибка загрузки') })
      }
    }

    const timer = window.setTimeout(() => {
      finish({
        ok: false,
        error:
          'Таймаут ответа Apps Script (postMessage). Проверьте upload_url и деплой Web App.',
      })
    }, UPLOAD_TIMEOUT_MS)

    window.addEventListener('message', onMessage)
    document.body.appendChild(iframe)
    document.body.appendChild(form)

    try {
      form.submit()
    } catch (error) {
      finish({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Не удалось отправить форму в Apps Script',
      })
    }
  })
}

async function toSchemeFilePayload(file: SchemeUploadFile): Promise<SchemeFilePayload> {
  const base64 =
    file.base64 ??
    (await blobToBase64(
      file.blob.type === 'image/png'
        ? file.blob
        : new Blob([file.blob], { type: 'image/png' }),
    ))
  return {
    name: file.filename,
    mimeType: 'image/png',
    base64,
  }
}

/** Один PNG-файл схемы из DOM-элемента панели */
export async function buildSchemeFileFromElement(
  el: HTMLElement,
  mode: 'data' | 'power',
  screenName: string,
  eventName?: string,
): Promise<SchemeUploadFile> {
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
    base64: stripPngDataUrlPrefix(dataUrl),
  }
}

/**
 * Снимает все видимые панели схем на странице (data + power).
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
    const dataUrl = await capturePanelPng(el, 3)
    if (!dataUrl.startsWith('data:image/png')) {
      throw new Error('Снимок схемы не в формате PNG')
    }
    const blob = await dataUrlToPngBlob(dataUrl)
    files.push({
      filename: panelExportFilename(mode, screenHint, eventName),
      blob: blob.type === 'image/png' ? blob : new Blob([blob], { type: 'image/png' }),
      base64: stripPngDataUrlPrefix(dataUrl),
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
 * Отправка PNG в Apps Script выезда через form-bridge (scheme_payload + postMessage).
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

  try {
    const filePayloads = await Promise.all(files.map((file) => toSchemeFilePayload(file)))
    const payload: SchemeUploadPayload = {
      action: 'uploadSchemeImages',
      trip_id: bridge.tripId,
      upload_token: bridge.uploadToken,
      files: filePayloads,
      meta: {
        source: 'led-cable-mapper',
        title: bridge.title || undefined,
        types: bridge.types || undefined,
      },
    }
    return await postSchemeForm(bridge.uploadUrl, payload)
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'Не удалось подготовить отправку схем в выезд',
    }
  }
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
