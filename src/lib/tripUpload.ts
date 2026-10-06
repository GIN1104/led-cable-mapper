import {
  downloadDataUrl,
  panelExportFilename,
  capturePanelPng,
} from './panelExport'
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

  const envelope = parsed as Record<string, unknown>
  // Контракт crew / Apps Script:
  // { channel: 'crew-scheme-response', nonce: '', result: { ok, error?, uploaded? } }
  const channel = typeof envelope.channel === 'string' ? envelope.channel : ''
  const isCrewChannel =
    channel === 'crew-scheme-response' || channel === 'scheme-response'

  const msgNonce = findStringField(parsed, [
    'scheme_nonce',
    'nonce',
    'clientNonce',
    'requestNonce',
  ])
  // Пустой nonce от GAS — норма; не сравнивать с нашим UUID.
  // Непустой — обязан совпасть (защита от чужих postMessage).
  if (msgNonce && msgNonce !== nonce) return null

  // Для crew-канала без nonce принимаем только пока ждём ответ (один pending).
  if (!msgNonce && !isCrewChannel) {
    // без канала и без nonce — только если есть явный ok на верхнем уровне
    if (typeof envelope.ok !== 'boolean' && !envelope.result) return null
  }

  const record = findOkRecord(parsed)
  if (!record) {
    const err = findStringField(parsed, ['error', 'message'])
    if (err) {
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

/** Сохранить PNG схем на диск (обход, если GAS отклонил токен). */
export async function downloadSchemeFilesLocally(
  files: SchemeUploadFile[],
): Promise<number> {
  let n = 0
  for (const file of files) {
    const dataUrl = file.base64
      ? `data:image/png;base64,${file.base64}`
      : await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result ?? ''))
          reader.onerror = () => reject(reader.error ?? new Error('FileReader'))
          reader.readAsDataURL(file.blob)
        })
    downloadDataUrl(dataUrl, file.filename)
    n += 1
    await new Promise((r) => window.setTimeout(r, 120))
  }
  return n
}

const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

export interface TripDiagnoseProbe {
  id: string
  title: string
  ok: boolean | null
  error: string | null
  raw: unknown
  ms: number
  note?: string
}

function submitFormFieldsAndWait(
  uploadUrl: string,
  fields: Record<string, string>,
  timeoutMs = 25_000,
): Promise<{ ok: boolean | null; error: string | null; raw: unknown; ms: number }> {
  return new Promise((resolve) => {
    const nonce = makeNonce()
    const frameName = `diag-${nonce}`
    const started = Date.now()
    let settled = false

    const iframe = document.createElement('iframe')
    iframe.name = frameName
    iframe.style.cssText =
      'position:absolute;width:1px;height:1px;border:0;opacity:0;left:-9999px'
    document.body.appendChild(iframe)

    const form = document.createElement('form')
    form.method = 'POST'
    form.action = uploadUrl
    form.target = frameName
    form.enctype = 'application/x-www-form-urlencoded'
    form.style.display = 'none'
    const withNonce = {
      ...fields,
      scheme_nonce: fields.scheme_nonce ?? nonce,
      clientOrigin: fields.clientOrigin ?? window.location.origin,
      client_origin: fields.client_origin ?? window.location.origin,
    }
    appendFormFields(form, withNonce)
    document.body.appendChild(form)

    const cleanup = () => {
      window.removeEventListener('message', onMessage, true)
      window.clearTimeout(timer)
      form.remove()
      iframe.remove()
    }

    const finish = (ok: boolean | null, error: string | null, raw: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      resolve({ ok, error, raw, ms: Date.now() - started })
    }

    const onMessage = (event: MessageEvent) => {
      const data = event.data
      if (!data || typeof data !== 'object') return
      const envelope = data as Record<string, unknown>
      if (
        envelope.channel === 'crew-scheme-response' ||
        typeof (envelope.result as { ok?: boolean } | undefined)?.ok === 'boolean' ||
        typeof envelope.ok === 'boolean'
      ) {
        const parsed = resultFromUnknown(data, withNonce.scheme_nonce || nonce)
        if (parsed) {
          finish(parsed.ok, parsed.error ?? null, data)
          return
        }
        finish(null, 'получен postMessage, но формат не разобран', data)
      }
    }

    const timer = window.setTimeout(() => {
      finish(null, 'timeout — нет postMessage', null)
    }, timeoutMs)

    window.addEventListener('message', onMessage, true)
    try {
      form.submit()
    } catch (error) {
      finish(
        false,
        error instanceof Error ? error.message : 'form.submit failed',
        null,
      )
    }
  })
}

/**
 * Зонд: несколько запросов к upload_url, чтобы локализовать отказ.
 * Результат — console + возвращаемый отчёт (для alert).
 */
export async function diagnoseTripUpload(bridge: TripBridge): Promise<{
  summary: string
  probes: TripDiagnoseProbe[]
  verdict: string
}> {
  const tinyFile = {
    name: 'diag-probe.png',
    mimeType: 'image/png',
    base64: TINY_PNG_B64,
  }

  const basePayload = {
    action: 'uploadSchemeImages' as const,
    trip_id: bridge.tripId,
    upload_token: bridge.uploadToken,
    files: [tinyFile],
    meta: { source: 'led-cable-mapper', title: bridge.title || 'diag' },
  }

  const probesPlan: Array<{
    id: string
    title: string
    fields: Record<string, string>
    note?: string
  }> = [
    {
      id: 'A_normal',
      title: 'A. Нормальный scheme_payload (как кнопка Отправить)',
      fields: {
        scheme_payload: JSON.stringify(basePayload),
      },
    },
    {
      id: 'B_no_token',
      title: 'B. Без upload_token в JSON',
      fields: {
        scheme_payload: JSON.stringify({ ...basePayload, upload_token: '' }),
      },
      note: 'Если ошибка ДРУГАЯ, чем у A — сервер читает токен из payload',
    },
    {
      id: 'C_bad_token',
      title: 'C. Заведомо неверный upload_token',
      fields: {
        scheme_payload: JSON.stringify({
          ...basePayload,
          upload_token: '00000000000000000000000000000000',
        }),
      },
      note: 'Если как у A — отказ именно auth, не формат PNG',
    },
    {
      id: 'D_no_files',
      title: 'D. Пустой files[]',
      fields: {
        scheme_payload: JSON.stringify({ ...basePayload, files: [] }),
      },
      note: 'Если всё ещё unauthorized — падает ДО проверки файлов',
    },
    {
      id: 'E_top_level_auth',
      title: 'E. Токен ещё и в полях формы (дубль)',
      fields: {
        scheme_payload: JSON.stringify(basePayload),
        action: 'uploadSchemeImages',
        trip_id: bridge.tripId,
        upload_token: bridge.uploadToken,
        upload_transport: 'form',
      },
    },
    {
      id: 'F_wrong_trip',
      title: 'F. Чужой trip_id, тот же token',
      fields: {
        scheme_payload: JSON.stringify({
          ...basePayload,
          trip_id: '00000000000000000000000000000000',
        }),
      },
      note: 'Если ошибка другая — сервер сверяет token↔trip',
    },
  ]

  const probes: TripDiagnoseProbe[] = []
  for (const plan of probesPlan) {
    // eslint-disable-next-line no-await-in-loop
    const res = await submitFormFieldsAndWait(bridge.uploadUrl, plan.fields)
    probes.push({
      id: plan.id,
      title: plan.title,
      ok: res.ok,
      error: res.error,
      raw: res.raw,
      ms: res.ms,
      note: plan.note,
    })
  }

  const errOf = (id: string) =>
    probes.find((p) => p.id === id)?.error?.toLowerCase() ?? ''

  const a = errOf('A_normal')
  const b = errOf('B_no_token')
  const c = errOf('C_bad_token')
  const d = errOf('D_no_files')
  const f = errOf('F_wrong_trip')

  let verdict: string
  if (probes.some((p) => p.ok === true)) {
    verdict =
      'Один из вариантов ПРОШЁЛ — смотри какой probe ok=true; подстроим mapper под него.'
  } else if (
    a.includes('unauthorized') &&
    c.includes('unauthorized') &&
    b.includes('unauthorized')
  ) {
    verdict =
      'ПРОБЛЕМА НА GAS (auth): и валидный, и пустой, и фейковый токен → одинаковый unauthorized. ' +
      'Mapper шлёт payload верно; сервер не принимает upload_token / сломан деплой или хранилище токенов. ' +
      'Обойти отказ с клиента нельзя — чинить doPost/проверку токена у хозяина Apps Script. ' +
      'Картинки можно сохранить локально кнопкой «Скачать PNG».'
  } else if (a.includes('unauthorized') && !b.includes('unauthorized')) {
    verdict =
      'Сервер читает upload_token (пустой токен даёт другую ошибку). Значит токен из ссылки не совпадает с тем, что лежит в Storage GAS для этого trip_id.'
  } else if (a.includes('unauthorized') && f && !f.includes('unauthorized')) {
    verdict =
      'Токен привязан к trip_id (чужой trip даёт другую ошибку). Проверьте пару trip_id↔upload_token в боте.'
  } else if (a.includes('unauthorized') && d && !d.includes('unauthorized')) {
    verdict =
      'Auth проходит, падает на файлах — смотрите формат files[].base64 на GAS.'
  } else {
    verdict =
      'Смотрите таблицу probe в console — ошибки различаются; пришлите хозяинy GAS этот лог.'
  }

  const report = {
    when: new Date().toISOString(),
    origin: typeof window !== 'undefined' ? window.location.origin : '',
    tripId: bridge.tripId,
    tokenPrefix: bridge.uploadToken.slice(0, 16),
    tokenLength: bridge.uploadToken.length,
    uploadUrl: bridge.uploadUrl,
    probes,
    verdict,
  }

  console.group('[TripUpload DIAG]')
  console.log('bridge', {
    tripId: report.tripId,
    tokenPrefix: report.tokenPrefix,
    tokenLength: report.tokenLength,
    uploadUrl: report.uploadUrl,
    origin: report.origin,
  })
  console.table(
    probes.map((p) => ({
      id: p.id,
      title: p.title,
      ok: p.ok,
      error: p.error,
      ms: p.ms,
    })),
  )
  console.log('raw messages', probes.map((p) => ({ id: p.id, raw: p.raw })))
  console.log('VERDICT:', verdict)
  console.groupEnd()

  const summary = [
    'Диагностика upload → Apps Script',
    `trip: ${bridge.tripId}`,
    `token: ${report.tokenPrefix}… (${report.tokenLength} символов)`,
    `origin: ${report.origin}`,
    '',
    ...probes.map(
      (p) =>
        `${p.id}: ok=${String(p.ok)} err=${p.error ?? '—'} (${p.ms}ms)`,
    ),
    '',
    `ВЫВОД: ${verdict}`,
    '',
    'Подробности: Console → [TripUpload DIAG]',
  ].join('\n')

  return { summary, probes, verdict }
}
