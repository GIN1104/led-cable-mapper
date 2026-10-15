const CLIENT_ID_KEY = 'led-cable-mapper:google-oauth-client-id'
const TOKEN_KEY = 'led-cable-mapper:google-drive-token'
/** Аккаунт Drive. hint пропускает выбор, если этот адрес уже вошёл в браузере. */
const DRIVE_ACCOUNT_HINT = 'ledvision2026.il@gmail.com'
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet'

/** Токен на время вкладки, чтобы попап Google не открывался второй раз за одну отправку. */
let cachedToken: string | null = null

interface GoogleTokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface GoogleTokenClient {
  requestAccessToken: (override?: { prompt?: '' | 'consent' }) => void
}

function gisReady(): boolean {
  return Boolean(window.google?.accounts?.oauth2)
}

function loadGis(): Promise<void> {
  if (gisReady()) return Promise.resolve()
  return new Promise((resolve, reject) => {
    if (!document.querySelector('script[data-gis="1"]')) {
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.dataset.gis = '1'
      script.onerror = () => reject(new Error('Не удалось загрузить вход Google'))
      document.head.appendChild(script)
    }
    const started = Date.now()
    const tick = () => {
      if (gisReady()) resolve()
      else if (Date.now() - started > 8000) {
        reject(new Error('Вход Google не ответил'))
      } else {
        window.setTimeout(tick, 50)
      }
    }
    tick()
  })
}

function readClientId(): string {
  const fromEnv = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim()
  if (fromEnv) return fromEnv
  try {
    return localStorage.getItem(CLIENT_ID_KEY)?.trim() ?? ''
  } catch {
    return ''
  }
}

function askClientId(): string {
  const entered = window.prompt(
    'Чтобы положить Excel на Google Drive и получить ссылку для правки, вставьте OAuth Client ID\n' +
      '(Google Cloud → Google Drive API → OAuth client, тип Web).\n\n' +
      'Authorized JavaScript origins:\n' +
      'http://localhost:5173\n' +
      'http://localhost:5174\n' +
      'https://gin1104.github.io\n\n' +
      'ID сохранится только в этом браузере.',
  )
  const id = entered?.trim() ?? ''
  if (!id) throw new Error('cancelled')
  try {
    localStorage.setItem(CLIENT_ID_KEY, id)
  } catch {
    // браузер запретил storage — используем ID только на этот раз
  }
  return id
}

function rememberToken(token: string, expiresInSec?: number): void {
  cachedToken = token
  const ttlMs = Math.max(60, (expiresInSec ?? 3600) - 60) * 1000
  try {
    sessionStorage.setItem(
      TOKEN_KEY,
      JSON.stringify({ token, exp: Date.now() + ttlMs }),
    )
  } catch {
    // сессия браузера недоступна — токен только в памяти вкладки
  }
}

function readRememberedToken(): string | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { token?: string; exp?: number }
    if (!parsed.token || !parsed.exp || parsed.exp <= Date.now()) {
      sessionStorage.removeItem(TOKEN_KEY)
      return null
    }
    return parsed.token
  } catch {
    return null
  }
}

function forgetToken(): void {
  cachedToken = null
  try {
    sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // ignore
  }
}

function requestAccessToken(
  clientId: string,
  prompt: '' | 'consent',
): Promise<{ token: string; expiresIn?: number }> {
  return new Promise((resolve, reject) => {
    const oauth = window.google?.accounts?.oauth2
    if (!oauth) {
      reject(new Error('Вход Google недоступен'))
      return
    }
    const client: GoogleTokenClient = oauth.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      hint: DRIVE_ACCOUNT_HINT,
      callback: (resp: GoogleTokenResponse) => {
        if (resp.access_token) {
          resolve({ token: resp.access_token, expiresIn: resp.expires_in })
          return
        }
        const message = resp.error_description || resp.error || 'Google не выдал доступ'
        if (/invalid_client|deleted_client/i.test(message)) {
          try {
            localStorage.removeItem(CLIENT_ID_KEY)
          } catch {
            // ignore
          }
        }
        reject(new Error(message))
      },
      error_callback: (err: { type?: string; message?: string }) => {
        if (err.type === 'popup_closed' || err.type === 'popup_failed_to_open') {
          reject(new Error('cancelled'))
          return
        }
        reject(new Error(err.message || err.type || 'Ошибка окна Google'))
      },
    })
    // Пустой prompt не открывает выбор аккаунта, если доступ уже выдан этому hint.
    client.requestAccessToken({ prompt })
  })
}

/** Вход в Google Drive. Вызывать в начале клика, пока браузер ещё разрешает окно входа. */
export async function ensureDriveAccess(): Promise<void> {
  await driveToken()
}

async function driveToken(): Promise<string> {
  if (cachedToken) return cachedToken
  const remembered = readRememberedToken()
  if (remembered) {
    cachedToken = remembered
    return remembered
  }
  await loadGis()
  const clientId = readClientId() || askClientId()
  try {
    const first = await requestAccessToken(clientId, '')
    rememberToken(first.token, first.expiresIn)
    return first.token
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'cancelled' || /invalid_client|deleted_client/i.test(message)) throw error
  }
  const second = await requestAccessToken(clientId, 'consent')
  rememberToken(second.token, second.expiresIn)
  return second.token
}

function editLink(fileId: string): string {
  return `https://docs.google.com/spreadsheets/d/${fileId}/edit`
}

async function driveJson<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  })
  if (response.status === 401) forgetToken()
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `Google Drive: ${response.status}`)
  }
  return (await response.json()) as T
}

async function findFolder(
  token: string,
  name: string,
  parentId?: string,
): Promise<string | null> {
  const clauses = [
    `name = '${name.replace(/'/g, "\\'")}'`,
    `mimeType = '${FOLDER_MIME}'`,
    'trashed = false',
  ]
  if (parentId) clauses.push(`'${parentId}' in parents`)
  const url =
    'https://www.googleapis.com/drive/v3/files?q=' +
    encodeURIComponent(clauses.join(' and ')) +
    '&fields=files(id)&pageSize=1&spaces=drive'
  const data = await driveJson<{ files?: { id: string }[] }>(token, url)
  return data.files?.[0]?.id ?? null
}

async function createFolder(
  token: string,
  name: string,
  parentId?: string,
): Promise<string> {
  const data = await driveJson<{ id?: string }>(
    token,
    'https://www.googleapis.com/drive/v3/files?fields=id',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: FOLDER_MIME,
        ...(parentId ? { parents: [parentId] } : {}),
      }),
    },
  )
  if (!data.id) throw new Error(`Не удалось создать папку «${name}» на Google Drive`)
  return data.id
}

/** Папка LED Warehouse / Excel. Создаёт недостающие уровни. */
async function excelFolderId(token: string): Promise<string> {
  const warehouse =
    (await findFolder(token, 'LED Warehouse')) ??
    (await createFolder(token, 'LED Warehouse'))
  return (
    (await findFolder(token, 'Excel', warehouse)) ??
    (await createFolder(token, 'Excel', warehouse))
  )
}

/** Любой, у кого есть ссылка, может править файл. */
async function shareAnyoneCanEdit(token: string, fileId: string): Promise<void> {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role: 'writer',
        type: 'anyone',
        allowFileDiscovery: false,
      }),
    },
  )
  if (response.ok) return
  const text = await response.text()
  throw new Error(
    text || 'Файл создан, но право «править по ссылке» Google Drive не выдал',
  )
}

/**
 * Кладёт .xlsx на Диск как Google Таблицу.
 * Наружу возвращается только ссылка с правом править.
 */
export async function uploadSpreadsheetEditLink(
  blob: Blob,
  filename: string,
): Promise<string> {
  const token = await driveToken()
  const folderId = await excelFolderId(token)
  const sheetName = filename.replace(/\.xlsx$/i, '') || filename
  const metadata = {
    name: sheetName,
    mimeType: SHEET_MIME,
    parents: [folderId],
  }
  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  form.append('file', new Blob([await blob.arrayBuffer()], { type: XLSX_MIME }), filename)

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
  )
  if (response.status === 401) forgetToken()
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `Google Drive: ${response.status}`)
  }
  const data = (await response.json()) as { id?: string }
  if (!data.id) throw new Error('Google Drive не вернул файл')
  await shareAnyoneCanEdit(token, data.id)
  return editLink(data.id)
}

/** Загружает Excel на Диск и возвращает только ссылку для правки. */
export async function uploadBlobToGoogleDrive(blob: Blob, filename: string): Promise<string> {
  return uploadSpreadsheetEditLink(blob, filename)
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string
            scope: string
            hint?: string
            callback: (resp: GoogleTokenResponse) => void
            error_callback?: (err: { type?: string; message?: string }) => void
          }) => GoogleTokenClient
        }
      }
    }
  }
}
