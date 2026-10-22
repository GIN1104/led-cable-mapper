/** Публичный Web Client ID. Это не секрет: он всё равно виден в браузере. */
export const PUBLIC_GOOGLE_CLIENT_ID =
  '821406929437-le4vbhpvf8b0khkpdhid8s0fu47bgn3o.apps.googleusercontent.com'

/** Диск, куда кладётся Excel. */
export const DRIVE_OWNER_EMAIL = 'ledvision2026.il@gmail.com'

/** Эти адреса могут пройти окно Google и писать в папку владельца. */
export const ALLOWED_DRIVE_EMAILS = [
  DRIVE_OWNER_EMAIL,
  'starchenkogin@gmail.com',
] as const

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'
export const DRIVE_REDIRECTING = 'redirecting'
export const DRIVE_CANCELLED = 'cancelled'

const OAUTH_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

export function isAllowedDriveEmail(email: string): boolean {
  const normalized = normalizeEmail(email)
  return ALLOWED_DRIVE_EMAILS.some((item) => item === normalized)
}

export function allowedDriveEmailsLabel(): string {
  return ALLOWED_DRIVE_EMAILS.join(' или ')
}

export function oauthRedirectUri(origin: string, basePath: string): string {
  const originClean = origin.replace(/\/$/, '')
  const path = basePath.startsWith('/') ? basePath : `/${basePath}`
  const withSlash = path.endsWith('/') ? path : `${path}/`
  return `${originClean}${withSlash}`
}

/** Первое окно Google: выбор почты, без login_hint, который это окно пропускает. */
export function googleAccountChooserUrl(options: {
  clientId: string
  redirectUri: string
  state: string
  scope?: string
}): string {
  const url = new URL(OAUTH_AUTH)
  url.searchParams.set('client_id', options.clientId)
  url.searchParams.set('redirect_uri', options.redirectUri)
  url.searchParams.set('response_type', 'token')
  url.searchParams.set('scope', options.scope ?? DRIVE_SCOPE)
  url.searchParams.set('prompt', 'select_account')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('state', options.state)
  return url.toString()
}

export interface OAuthRedirectResult {
  token: string | null
  expiresIn: number | null
  state: string | null
  error: string | null
}

export function readOAuthRedirectResult(hash: string): OAuthRedirectResult | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw.includes('access_token=') && !raw.includes('error=')) return null
  const params = new URLSearchParams(raw)
  const expires = Number(params.get('expires_in') ?? '')
  return {
    token: params.get('access_token'),
    expiresIn: Number.isFinite(expires) && expires > 0 ? expires : null,
    state: params.get('state'),
    error: params.get('error'),
  }
}

export interface DriveFolderRef {
  id: string
  name: string
  ownerEmail?: string
  parentName?: string
}

/** Папка Excel на Диске ledvision, а не одноимённая папка другого аккаунта. */
export function pickLedExcelFolder(
  folders: DriveFolderRef[],
  ownerEmail: string = DRIVE_OWNER_EMAIL,
): string | null {
  const owner = normalizeEmail(ownerEmail)
  const owned = folders.filter(
    (folder) =>
      folder.id &&
      normalizeEmail(folder.name) === 'excel' &&
      normalizeEmail(folder.ownerEmail ?? '') === owner,
  )
  const inWarehouse = owned.find(
    (folder) => normalizeEmail(folder.parentName ?? '') === 'led warehouse',
  )
  return (inWarehouse ?? owned[0])?.id ?? null
}

/** Telegram и другие встроенные браузеры блокируют окно Google. Там вход — отдельной страницей. */
export function usePageGoogleLogin(input: {
  userAgent: string
  telegram: boolean
}): boolean {
  if (input.telegram) return true
  return /Telegram|Instagram|FBAN|FBAV|Line\//i.test(input.userAgent)
}
