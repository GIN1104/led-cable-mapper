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

/** Заранее созданный frame (синхронно по клику, до await capture) */
export interface SchemeBridgeHandle {
  nonce: string
  frameName: string
  iframe: HTMLIFrameElement
}

const CAPTURE_RATIO = 2
const BRIDGE_TIMEOUT_MS = 90_000

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

function findStringField(obj: unknown, keys: string[], depth = 0): string | null {
  if (depth > 5 || !obj || typeof obj !== 'object') return null
  const record = obj as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value) return value
  }
  for (const value of Object.values(record)) {
    const found = findStringField(value, keys, depth + 1)
    if (found) return found
  }
  return null
}

function findOkRecord(obj: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 5 || !obj || typeof obj !== 'object') return null
  const record = obj as Record<string, unknown>
  if (typeof record.ok === 'boolean') return record
  for (const key of ['result', 'payload', 'data', 'body', 'response']) {
    const nested = findOkRecord(record[key], depth + 1)
    if (nested) return nested
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') {
      const nested = findOkRecord(value, depth + 1)
      if (nested) return nested
    }
  }
  return null
}

function resultFromUnknown(data: unknown, nonce: string): TripUploadResult | null {
  if (data == null) return null

  let parsed: unknown = data
  if (typeof parsed === 'string') {
    const trimmed = parsed.trim()
    if (!trimmed) return null
    try {
      parsed = JSON.parse(trimmed) as unknown
    } catch {
      if (/unauthorized/i.test(trimmed)) {
        return { ok: false, error: formatUploadError(trimmed, 'unauthorized') }
      }
      return null
    }
  }
  if (!parsed || typeof parsed !== 'object') return null

  const msgNonce = findStringField(parsed, [
    'scheme_nonce',
    'nonce',
    'clientNonce',
    'requestNonce',
  ])
  if (msgNonce && msgNonce !== nonce) return null

  const record = findOkRecord(parsed)
  if (!record) {
    const err = findStringField(parsed, ['error', 'message'])
    if (err && (!msgNonce || msgNonce === nonce)) {
      return { ok: false, error: formatUploadError(err, 'Ошибка загрузки') }
    }
    return null
  }

  return {
    ok: Boolean(record.ok),
    uploaded: typeof record.uploaded === 'number' ? record.uploaded : undefined,
    error: record.ok
      ? undefined
      : formatUploadError(String(record.error ?? ''), 'Ошибка загрузки'),
  }
}

function resultFromResponseText(text: string, nonce: string): TripUploadResult | null {
  const direct = resultFromUnknown(text, nonce)
  if (direct) return direct

  const patterns = [
    /postMessage\(\s*(\{[\s\S]*?\})\s*,/g,
    /postMessage\(\s*JSON\.stringify\(\s*(\{[\s\S]*?\})\s*\)/g,
    /postMessage\(\s*'(\{[\s\S]*?\})'\s*,/g,
    /postMessage\(\s*"(\{[\s\S]*?\})"\s*,/g,
  ]

  for (const re of patterns) {
    let match: RegExpExecArray | null
    while ((match = re.exec(text)) != null) {
      const raw = match[1]
      if (!raw) continue
      const candidate = resultFromUnknown(raw, nonce)
      if (candidate) return candidate
    }
  }

  const okMatch = text.match(/\{[^{}]*"ok"\s*:\s*(?:true|false)[^{}]*\}/)
  if (okMatch?.[0]) {
    const candidate = resultFromUnknown(okMatch[0], nonce)
    if (candidate) return candidate
  }

  return null
}

/**
 * Вызвать синхронно в onClick (до любых await), чтобы iframe был готов к form.submit.
 */
export function prepareSchemeBridge(): SchemeBridgeHandle {
  const nonce = makeNonce()
  const frameName = `led-trip-upload-${nonce}`
  const iframe = document.createElement('iframe')
  iframe.name = frameName
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText =
    'position:absolute;width:1px;height:1px;border:0;opacity:0;left:-9999px;top:0'
  document.body.appendChild(iframe)
  return { nonce, frameName, iframe }
}

function appendFormFields(form: HTMLFormElement, fields: Record<string, string>) {
  for (const [name, value] of Object.entries(fields)) {
    const field = document.createElement('textarea')
    field.name = name
    field.value = value
    form.appendChild(field)
  }
}

function bridgeFields(payload: SchemeUploadPayload, nonce: string): Record<string, string> {
  const json = JSON.stringify(payload)
  const origin = window.location.origin
  return {
    scheme_payload: json,
    scheme_nonce: nonce,
    clientOrigin: origin,
    client_origin: origin,
    nonce,
  }
}

/**
 * HTML-форма → scheme_payload (JSON + PNG base64) → ответ postMessage.
 */
export function postSchemeForm(
  uploadUrl: string,
  payload: SchemeUploadPayload,
  bridge?: SchemeBridgeHandle | null,
): Promise<TripUploadResult> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return Promise.resolve({ ok: false, error: 'postSchemeForm только в браузере' })
  }

  const handle = bridge ?? prepareSchemeBridge()
  const { nonce, frameName, iframe } = handle

  return new Promise((resolve) => {
    let settled = false

    const form = document.createElement('form')
    form.method = 'POST'
    form.action = uploadUrl
    form.target = frameName
    form.acceptCharset = 'UTF-8'
    form.style.display = 'none'
    form.enctype = 'application/x-www-form-urlencoded'
    appendFormFields(form, bridgeFields(payload, nonce))

    const cleanup = () => {
      window.removeEventListener('message', onMessage, true)
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
      const result = resultFromUnknown(event.data, nonce)
      if (result) finish(result)
    }

    const timer = window.setTimeout(() => {
      // Последняя попытка: иногда ответ лежит в HTML iframe (same-origin не будет),
      // либо fetch тем же payload — только если postMessage молчит (токен мог сгореть).
      void (async () => {
        try {
          const response = await fetch(uploadUrl, {
            method: 'POST',
            body: new URLSearchParams(bridgeFields(payload, nonce)),
            credentials: 'omit',
            mode: 'cors',
            redirect: 'follow',
          })
          const text = await response.text()
          const parsed = resultFromResponseText(text, nonce)
          if (parsed) {
            finish(parsed)
            return
          }
        } catch {
          /* ignore */
        }
        finish({
          ok: false,
          error:
            'Таймаут: Apps Script не прислал postMessage. ' +
            'На стороне GAS doPost должен вернуть HtmlService с ' +
            'top.postMessage({ok, scheme_nonce, uploaded/error}, clientOrigin).',
        })
      })()
    }, BRIDGE_TIMEOUT_MS)

    window.addEventListener('message', onMessage, true)
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

async function captureSchemeFile(
  el: HTMLElement,
  mode: 'data' | 'power',
  screenName: string,
  eventName?: string,
): Promise<SchemeUploadFile> {
  const dataUrl = await capturePanelPng(el, CAPTURE_RATIO)
  if (!dataUrl.startsWith('data:image/png')) {
    throw new Error('Снимок схемы не в формате PNG')
  }
  const blob = await dataUrlToPngBlob(dataUrl)
  return {
    filename: panelExportFilename(mode, screenName || 'screen', eventName),
    blob: blob.type === 'image/png' ? blob : new Blob([blob], { type: 'image/png' }),
    base64: stripPngDataUrlPrefix(dataUrl),
  }
}

/** Один PNG-файл схемы из DOM-элемента панели */
export async function buildSchemeFileFromElement(
  el: HTMLElement,
  mode: 'data' | 'power',
  screenName: string,
  eventName?: string,
): Promise<SchemeUploadFile> {
  return captureSchemeFile(el, mode, screenName, eventName)
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
  for (let i = 0; i < dataPanels.length; i++) {
    const screenHint =
      dataPanels[i]!.getAttribute('data-screen-name')?.trim() ||
      (dataPanels.length > 1 ? `screen-${i + 1}` : 'screen')
    files.push(await captureSchemeFile(dataPanels[i]!, 'data', screenHint, eventName))
  }
  for (let i = 0; i < powerPanels.length; i++) {
    const screenHint =
      powerPanels[i]!.getAttribute('data-screen-name')?.trim() ||
      (powerPanels.length > 1 ? `screen-${i + 1}` : 'screen')
    files.push(await captureSchemeFile(powerPanels[i]!, 'power', screenHint, eventName))
  }
  return files
}

/**
 * Отправка PNG в Apps Script выезда через form-bridge (scheme_payload + postMessage).
 * @param bridgeHandle — из prepareSchemeBridge() в синхронном onClick
 */
export async function uploadSchemeImagesToTrip(
  bridge: TripBridge,
  files: SchemeUploadFile[],
  bridgeHandle?: SchemeBridgeHandle | null,
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
    return await postSchemeForm(bridge.uploadUrl, payload, bridgeHandle)
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
