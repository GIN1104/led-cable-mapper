const CLIENT_ID_KEY = 'led-cable-mapper:google-oauth-client-id'
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

interface GoogleTokenResponse {
  access_token?: string
  error?: string
  error_description?: string
}

interface GoogleTokenClient {
  requestAccessToken: (override?: { prompt?: string }) => void
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
    'Чтобы сохранить файл в Google Drive, вставьте OAuth Client ID\n' +
      '(Google Cloud → Google Drive API → OAuth client, тип Web).\n\n' +
      'Authorized JavaScript origins:\n' +
      'http://localhost:5173\n' +
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

function requestAccessToken(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const oauth = window.google?.accounts?.oauth2
    if (!oauth) {
      reject(new Error('Вход Google недоступен'))
      return
    }
    const client: GoogleTokenClient = oauth.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (resp: GoogleTokenResponse) => {
        if (resp.access_token) {
          resolve(resp.access_token)
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
        reject(new Error(err.message || 'Ошибка окна Google'))
      },
    })
    client.requestAccessToken()
  })
}

/** Загружает файл в «Мой диск». Возвращает ссылку на файл. */
export async function uploadBlobToGoogleDrive(blob: Blob, filename: string): Promise<string> {
  await loadGis()
  const clientId = readClientId() || askClientId()
  const token = await requestAccessToken(clientId)

  const metadata = {
    name: filename,
    mimeType:
      blob.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }
  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  form.append('file', blob, filename)

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
  )
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `Google Drive: ${response.status}`)
  }
  const data = (await response.json()) as { id?: string; webViewLink?: string }
  if (data.webViewLink) return data.webViewLink
  if (data.id) return `https://drive.google.com/file/d/${data.id}/view`
  return 'https://drive.google.com/drive/my-drive'
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string
            scope: string
            callback: (resp: GoogleTokenResponse) => void
            error_callback?: (err: { type?: string; message?: string }) => void
          }) => GoogleTokenClient
        }
      }
    }
  }
}
