/** Deep-link выезда из Telegram-бота → LED Cable Mapper (sessionStorage, без upload_token в localStorage). */

export const TRIP_BRIDGE_STORAGE_KEY = 'led-cable-mapper:trip-bridge:v1'

export interface TripBridge {
  tripId: string
  title: string
  address: string
  date: string
  time: string
  car: string
  types: string
  uploadUrl: string
  uploadToken: string
  uploadTransport: 'form' | string
  returnTripUrl: string
}

const QUERY_KEYS = [
  'trip_id',
  'title',
  'address',
  'date',
  'time',
  'car',
  'types',
  'upload_url',
  'upload_token',
  'upload_transport',
  'return_trip_url',
] as const

function pick(params: URLSearchParams, key: string): string {
  const raw = params.get(key)
  if (raw == null) return ''
  try {
    return raw.trim()
  } catch {
    return String(raw).trim()
  }
}

/** YYYY-MM-DD → DD.MM.YYYY (как удобнее для шапки Excel); иначе как пришло */
export function formatTripDateForMeta(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim())
  if (!m) return date.trim()
  return `${m[3]}.${m[2]}.${m[1]}`
}

function paramsFromLocation(
  search: string,
  hash: string,
): URLSearchParams {
  const fromSearch = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search,
  )
  if (fromSearch.get('trip_id') && fromSearch.get('upload_url') && fromSearch.get('upload_token')) {
    return fromSearch
  }
  // Запасной вариант: параметры в hash (некоторые клиенты Telegram так открывают)
  const rawHash = hash.startsWith('#') ? hash.slice(1) : hash
  if (rawHash.includes('trip_id=')) {
    const q = rawHash.startsWith('?') ? rawHash.slice(1) : rawHash
    return new URLSearchParams(q)
  }
  return fromSearch
}

export function parseTripBridgeFromUrl(
  search: string = typeof window !== 'undefined' ? window.location.search : '',
  hash: string = typeof window !== 'undefined' ? window.location.hash : '',
): TripBridge | null {
  const params = paramsFromLocation(search, hash)
  const tripId = pick(params, 'trip_id')
  const uploadUrl = pick(params, 'upload_url')
  const uploadToken = pick(params, 'upload_token')
  if (!tripId || !uploadUrl || !uploadToken) return null

  return {
    tripId,
    title: pick(params, 'title'),
    address: pick(params, 'address'),
    date: pick(params, 'date'),
    time: pick(params, 'time'),
    car: pick(params, 'car'),
    types: pick(params, 'types'),
    uploadUrl,
    uploadToken,
    uploadTransport: pick(params, 'upload_transport') || 'form',
    returnTripUrl: pick(params, 'return_trip_url'),
  }
}

export function saveTripBridge(bridge: TripBridge): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(TRIP_BRIDGE_STORAGE_KEY, JSON.stringify(bridge))
  } catch {
    /* quota / private mode */
  }
}

export function loadTripBridge(): TripBridge | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(TRIP_BRIDGE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<TripBridge>
    if (!parsed.tripId || !parsed.uploadUrl || !parsed.uploadToken) return null
    return {
      tripId: String(parsed.tripId),
      title: String(parsed.title ?? ''),
      address: String(parsed.address ?? ''),
      date: String(parsed.date ?? ''),
      time: String(parsed.time ?? ''),
      car: String(parsed.car ?? ''),
      types: String(parsed.types ?? ''),
      uploadUrl: String(parsed.uploadUrl),
      uploadToken: String(parsed.uploadToken),
      uploadTransport: String(parsed.uploadTransport ?? 'form'),
      returnTripUrl: String(parsed.returnTripUrl ?? ''),
    }
  } catch {
    return null
  }
}

export function clearTripBridge(): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.removeItem(TRIP_BRIDGE_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/** Убрать чувствительные query из адресной строки после сохранения bridge */
export function stripTripQueryFromUrl(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  let changed = false
  for (const key of QUERY_KEYS) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key)
      changed = true
    }
  }
  if (!changed) return
  const qs = url.searchParams.toString()
  window.history.replaceState({}, '', `${url.pathname}${qs ? `?${qs}` : ''}${url.hash}`)
}

export function tripBridgeToMetaPatch(bridge: TripBridge): {
  eventName: string
  location: string
  eventDate: string
  hours: string
  car: string
  types: string
  tripId: string
} {
  return {
    eventName: bridge.title,
    location: bridge.address,
    eventDate: formatTripDateForMeta(bridge.date),
    hours: bridge.time,
    car: bridge.car,
    types: bridge.types,
    tripId: bridge.tripId,
  }
}

/**
 * URL карточки выезда с гарантированным trip_id текущего bridge.
 * Бот кладёт ?trip=…&view=files — если trip отсутствует/другой, подставляем свой.
 */
export function resolveReturnTripCardUrl(bridge: TripBridge): string | null {
  const raw = bridge.returnTripUrl?.trim()
  if (!raw || !bridge.tripId) return null
  try {
    const url = new URL(raw)
    const current =
      url.searchParams.get('trip') || url.searchParams.get('trip_id') || ''
    if (current !== bridge.tripId) {
      url.searchParams.delete('trip_id')
      url.searchParams.set('trip', bridge.tripId)
    }
    if (!url.searchParams.get('view')) {
      url.searchParams.set('view', 'files')
    }
    return url.toString()
  } catch {
    return raw
  }
}
