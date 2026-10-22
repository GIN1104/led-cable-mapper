import {
  ALLOWED_DRIVE_EMAILS,
  DRIVE_CANCELLED,
  DRIVE_OWNER_EMAIL,
  DRIVE_REDIRECTING,
  DRIVE_SCOPE,
  PUBLIC_GOOGLE_CLIENT_ID,
  allowedDriveEmailsLabel,
  googleAccountChooserUrl,
  isAllowedDriveEmail,
  normalizeEmail,
  oauthRedirectUri,
  driveUserPermissionUrl,
  permissionAlreadyGranted,
  pickLedExcelFolder,
  readOAuthRedirectResult,
  usePageGoogleLogin,
  type DriveFolderRef,
} from './googleAuth'

const CLIENT_ID_KEY = 'led-cable-mapper:google-oauth-client-id'
const TOKEN_KEY = 'led-cable-mapper:google-drive-token'
const OAUTH_STATE_KEY = 'led-cable-mapper:google-oauth-state'
const SIGN_IN_NOTICE_KEY = 'led-cable-mapper:google-sign-in-notice'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet'

/** Токен на время вкладки, чтобы окно Google не открывалось второй раз за одну отправку. */
let cachedToken: string | null = null
let cachedEmail: string | null = null

interface GoogleTokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface GoogleTokenClient {
  requestAccessToken: (override?: { prompt?: '' | 'consent' }) => void
}

interface StoredToken {
  token?: string
  exp?: number
  email?: string
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
    const stored = localStorage.getItem(CLIENT_ID_KEY)?.trim()
    if (stored) return stored
  } catch {
    // браузер запретил storage
  }
  return PUBLIC_GOOGLE_CLIENT_ID
}

function storageSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    // сессия недоступна
  }
  try {
    localStorage.setItem(key, value)
  } catch {
    // постоянное хранилище недоступно
  }
}

function storageGet(key: string): string | null {
  try {
    const fromSession = sessionStorage.getItem(key)
    if (fromSession) return fromSession
  } catch {
    // ignore
  }
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function storageRemove(key: string): void {
  try {
    sessionStorage.removeItem(key)
  } catch {
    // ignore
  }
  try {
    localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

function rememberToken(token: string, expiresInSec?: number, email?: string): void {
  cachedToken = token
  if (email) cachedEmail = normalizeEmail(email)
  const ttlMs = Math.max(60, (expiresInSec ?? 3600) - 60) * 1000
  storageSet(
    TOKEN_KEY,
    JSON.stringify({ token, exp: Date.now() + ttlMs, email: cachedEmail ?? undefined }),
  )
}

function readRememberedToken(): StoredToken | null {
  try {
    const raw = storageGet(TOKEN_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredToken
    if (!parsed.token || !parsed.exp || parsed.exp <= Date.now()) {
      storageRemove(TOKEN_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function forgetToken(): void {
  cachedToken = null
  cachedEmail = null
  storageRemove(TOKEN_KEY)
}

function pageLoginNeeded(): boolean {
  const telegram = Boolean(
    (window as Window & { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp
      ?.initData,
  )
  return usePageGoogleLogin({
    userAgent: navigator.userAgent,
    telegram,
  })
}

function currentRedirectUri(): string {
  return oauthRedirectUri(window.location.origin, import.meta.env.BASE_URL || '/')
}

/**
 * Полная страница Google вместо всплывающего окна.
 * Сейчас в клиенте зарегистрирован только http://localhost:3000/
 * Адрес сайта (https://gin1104.github.io/led-cable-mapper/) даёт redirect_uri_mismatch,
 * поэтому телефон на сайте открывает обычное окно выбора почты.
 */
function canUsePageLogin(): boolean {
  return currentRedirectUri() === 'http://localhost:3000/'
}

function redirectToAccountChooser(clientId: string): void {
  const state = Math.random().toString(36).slice(2)
  storageSet(OAUTH_STATE_KEY, state)
  const url = googleAccountChooserUrl({
    clientId,
    redirectUri: currentRedirectUri(),
    state,
  })
  window.location.assign(url)
}

function consumeGoogleRedirect(): void {
  if (typeof window === 'undefined') return
  const result = readOAuthRedirectResult(window.location.hash)
  if (!result) return
  const next = window.location.pathname + window.location.search
  window.history.replaceState(window.history.state, '', next)
  if (result.error) {
    storageSet(
      SIGN_IN_NOTICE_KEY,
      result.error === 'access_denied'
        ? 'Вход Google отменён. Выберите ledvision2026.il@gmail.com или starchenkogin@gmail.com.'
        : `Google: ${result.error}`,
    )
    return
  }
  if (!result.token) return
  const expected = storageGet(OAUTH_STATE_KEY)
  storageRemove(OAUTH_STATE_KEY)
  if (expected && result.state && expected !== result.state) {
    storageSet(SIGN_IN_NOTICE_KEY, 'Вход Google не совпал с этим окном. Нажмите кнопку ещё раз.')
    return
  }
  rememberToken(result.token, result.expiresIn ?? undefined)
  storageSet(
    SIGN_IN_NOTICE_KEY,
    'Вход Google выполнен. Нажмите сохранение ещё раз — файл ляжет на Диск ledvision2026.il@gmail.com.',
  )
}

consumeGoogleRedirect()

/** Текст после возврата из окна Google. Гаснет, когда сохранение начинается. */
export function peekDriveSignInNotice(): string | null {
  return storageGet(SIGN_IN_NOTICE_KEY)
}

function clearDriveSignInNotice(): void {
  storageRemove(SIGN_IN_NOTICE_KEY)
  window.dispatchEvent(new Event('led-drive-notice'))
}

function requestAccountChooser(clientId: string): Promise<{ token: string; expiresIn?: number }> {
  return new Promise((resolve, reject) => {
    const oauth = window.google?.accounts?.oauth2
    if (!oauth) {
      reject(new Error('Вход Google недоступен'))
      return
    }
    const client: GoogleTokenClient = oauth.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      // select_account показывает список почт. hint здесь нельзя: он пропускает выбор.
      prompt: 'select_account',
      callback: (resp: GoogleTokenResponse) => {
        if (resp.access_token) {
          resolve({ token: resp.access_token, expiresIn: resp.expires_in })
          return
        }
        const message = resp.error_description || resp.error || 'Google не выдал доступ'
        if (/origin_mismatch/i.test(message)) {
          reject(
            new Error(
              'Google не пускает этот сайт. В Google Cloud у OAuth client в Authorized JavaScript origins добавьте https://gin1104.github.io',
            ),
          )
          return
        }
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
        if (err.type === 'popup_failed_to_open') {
          if (canUsePageLogin()) {
            redirectToAccountChooser(clientId)
            reject(new Error(DRIVE_REDIRECTING))
            return
          }
          reject(
            new Error(
              'Браузер заблокировал окно Google. Откройте сайт в Chrome и нажмите ещё раз — появится выбор почты.',
            ),
          )
          return
        }
        if (err.type === 'popup_closed') {
          reject(new Error(DRIVE_CANCELLED))
          return
        }
        reject(new Error(err.message || err.type || 'Ошибка окна Google'))
      },
    })
    // Без override.prompt: пустой prompt снова спрятал бы список почт.
    client.requestAccessToken()
  })
}

function openAccountChooser(clientId: string): Promise<{ token: string; expiresIn?: number }> {
  if (pageLoginNeeded() && canUsePageLogin()) {
    redirectToAccountChooser(clientId)
    return new Promise(() => {})
  }
  if (!gisReady()) {
    return loadGis().then(
      () => requestAccountChooser(clientId),
      () => {
        redirectToAccountChooser(clientId)
        return new Promise<{ token: string; expiresIn?: number }>(() => {})
      },
    )
  }
  return requestAccountChooser(clientId)
}

async function fetchDriveEmail(token: string): Promise<string> {
  const data = await driveJson<{ user?: { emailAddress?: string } }>(
    token,
    'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',
  )
  const email = data.user?.emailAddress?.trim() ?? ''
  if (!email) throw new Error('Google не сообщил адрес аккаунта')
  return email
}

function rejectUnknownAccount(email: string): never {
  forgetToken()
  throw new Error(
    `Аккаунт ${email} не подключён. В окне Google выберите ${allowedDriveEmailsLabel()}.`,
  )
}

let signInFlight: Promise<string> | null = null

/** Открыть окно Google в том же нажатии, до любых await. */
export function beginDriveSignIn(): void {
  if (signInFlight) return
  signInFlight = driveToken().finally(() => {
    signInFlight = null
  })
}

/** Вход в Google Drive. Первый вызов открывает окно выбора почты. */
export async function ensureDriveAccess(): Promise<void> {
  if (!signInFlight) beginDriveSignIn()
  await signInFlight
}

/** Подгрузить скрипт Google до клика, чтобы окно выбора открылось сразу. */
export function preloadGoogleSignIn(): void {
  void loadGis().catch(() => undefined)
}

async function driveToken(): Promise<string> {
  if (cachedToken && cachedEmail) return cachedToken
  const remembered = readRememberedToken()
  if (remembered?.token) {
    cachedToken = remembered.token
    cachedEmail = remembered.email ? normalizeEmail(remembered.email) : null
  }
  if (!cachedToken) {
    const clientId = readClientId()
    const first = await openAccountChooser(clientId)
    rememberToken(first.token, first.expiresIn)
  }
  const token = cachedToken
  if (!token) throw new Error('Google не выдал доступ')
  if (!cachedEmail) {
    const email = normalizeEmail(await fetchDriveEmail(token))
    if (!isAllowedDriveEmail(email)) rejectUnknownAccount(email)
    cachedEmail = email
    rememberToken(token, undefined, email)
  } else if (!isAllowedDriveEmail(cachedEmail)) {
    rejectUnknownAccount(cachedEmail)
  }
  return token
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

async function ownFolder(token: string, name: string, parentId?: string): Promise<string> {
  const listed = await listNamedFolders(token, name)
  const mine = listed.find((folder) => {
    const ownerOk = normalizeEmail(folder.ownerEmail ?? '') === normalizeEmail(DRIVE_OWNER_EMAIL)
    return ownerOk && (parentId ? folder.parentId === parentId : true)
  })
  if (mine) return mine.id
  return createFolder(token, name, parentId)
}

const quietShares = new Set<string>()

async function shareFolderWith(token: string, folderId: string, email: string): Promise<void> {
  const key = `${folderId}:${normalizeEmail(email)}`
  if (quietShares.has(key)) return
  try {
    const listed = await driveJson<{
      permissions?: { emailAddress?: string; role?: string }[]
    }>(
      token,
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}/permissions?fields=permissions(emailAddress,role)&pageSize=100`,
    )
    if (permissionAlreadyGranted(listed.permissions, email)) {
      quietShares.add(key)
      return
    }
  } catch {
    // Список прав недоступен — попробуем выдать доступ без письма.
  }
  const response = await fetch(driveUserPermissionUrl(folderId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      role: 'writer',
      type: 'user',
      emailAddress: email,
    }),
  })
  if (response.ok || response.status === 409) {
    quietShares.add(key)
    return
  }
  const text = await response.text()
  if (/already exists|duplicate/i.test(text)) quietShares.add(key)
}

async function listNamedFolders(
  token: string,
  name: string,
): Promise<{ id: string; name: string; parentId?: string; ownerEmail?: string }[]> {
  const clauses = [
    `name = '${name.replace(/'/g, "\\'")}'`,
    `mimeType = '${FOLDER_MIME}'`,
    'trashed = false',
  ]
  const url =
    'https://www.googleapis.com/drive/v3/files?q=' +
    encodeURIComponent(clauses.join(' and ')) +
    '&fields=files(id,name,parents,owners(emailAddress))&pageSize=50&spaces=drive'
  const data = await driveJson<{
    files?: { id?: string; name?: string; parents?: string[]; owners?: { emailAddress?: string }[] }[]
  }>(token, url)
  return (data.files ?? []).flatMap((file) => {
    if (!file.id) return []
    return [
      {
        id: file.id,
        name: file.name ?? name,
        parentId: file.parents?.[0],
        ownerEmail: file.owners?.[0]?.emailAddress,
      },
    ]
  })
}

/** Папка LED Warehouse / Excel на Диске ledvision2026, даже если вошёл второй адрес. */
async function excelFolderId(token: string): Promise<string> {
  const email = cachedEmail ?? ''
  if (normalizeEmail(email) === normalizeEmail(DRIVE_OWNER_EMAIL)) {
    const warehouse = await ownFolder(token, 'LED Warehouse')
    const excel = await ownFolder(token, 'Excel', warehouse)
    for (const allowed of ALLOWED_DRIVE_EMAILS) {
      if (normalizeEmail(allowed) === normalizeEmail(DRIVE_OWNER_EMAIL)) continue
      await shareFolderWith(token, warehouse, allowed)
      await shareFolderWith(token, excel, allowed)
    }
    return excel
  }

  const listed = await listNamedFolders(token, 'Excel')
  const refs: DriveFolderRef[] = []
  for (const folder of listed) {
    let parentName = ''
    if (folder.parentId) {
      try {
        const parent = await driveJson<{ name?: string }>(
          token,
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folder.parentId)}?fields=name`,
        )
        parentName = parent.name ?? ''
      } catch {
        parentName = ''
      }
    }
    refs.push({
      id: folder.id,
      name: folder.name,
      ownerEmail: folder.ownerEmail,
      parentName,
    })
  }
  const existing = pickLedExcelFolder(refs)
  if (!existing) {
    throw new Error(
      'Папка Excel на Диске ledvision2026.il@gmail.com ещё не открыта для этого аккаунта. Один раз сохраните файл, выбрав ledvision2026.il@gmail.com.',
    )
  }
  return existing
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
  clearDriveSignInNotice()
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
            prompt?: '' | 'consent' | 'select_account'
            callback: (resp: GoogleTokenResponse) => void
            error_callback?: (err: { type?: string; message?: string }) => void
          }) => GoogleTokenClient
        }
      }
    }
  }
}
