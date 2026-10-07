/** Типы для официального bridge mapper-upload.js */

export interface MapperSchemeFile {
  name: string
  mimeType: string
  base64: string
}

export interface MapperSchemePayload {
  action: 'uploadSchemeImages'
  trip_id: string
  upload_token: string
  files: MapperSchemeFile[]
  meta?: {
    source?: string
    title?: string
    types?: string
  }
}

export interface MapperUploadResult {
  ok: boolean
  uploaded?: number
  error?: string
  detail?: string
}

export function getTripUploadContext(): {
  trip_id: string | null
  upload_token: string | null
  upload_url: string | null
  return_trip_url: string | null
  title: string
}

export function postSchemeForm(
  url: string,
  payload: MapperSchemePayload,
): Promise<MapperUploadResult>

export function sendSchemesToTrip(
  images: Array<{ name: string; blob: Blob }>,
): Promise<MapperUploadResult>

export function mountTripUploadButton(
  container: HTMLElement,
  exportPngs: () => Promise<Array<{ name: string; blob: Blob }>>,
): void

export function canvasPngs(
  canvases: ArrayLike<HTMLCanvasElement>,
): Promise<Array<{ name: string; blob: Blob }>>
