import { useState } from 'react'
import type { TripBridge } from '../lib/tripBridge'
import { formatTripDateForMeta } from '../lib/tripBridge'
import {
  chunkFiles,
  collectSchemePngFiles,
  uploadSchemeImagesToTrip,
} from '../lib/tripUpload'

interface TripBridgeBannerProps {
  bridge: TripBridge
  eventName?: string
  onDetach: () => void
}

export default function TripBridgeBanner({
  bridge,
  eventName,
  onDetach,
}: TripBridgeBannerProps) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const dateLabel = formatTripDateForMeta(bridge.date) || bridge.date
  const tripShort =
    bridge.tripId.length > 12 ? `${bridge.tripId.slice(0, 8)}…` : bridge.tripId

  const openCard = () => {
    if (!bridge.returnTripUrl) {
      window.alert('В ссылке нет return_trip_url — карточку выезда открыть нельзя.')
      return
    }
    window.open(bridge.returnTripUrl, '_blank', 'noopener,noreferrer')
  }

  const sendSchemes = async () => {
    if (busy) return
    setBusy(true)
    setStatus(null)
    try {
      const files = await collectSchemePngFiles(eventName || bridge.title)
      const batches = chunkFiles(files, 5)
      let uploaded = 0
      for (let i = 0; i < batches.length; i++) {
        setStatus(
          batches.length > 1
            ? `Отправка ${i + 1}/${batches.length}…`
            : 'Отправка схем…',
        )
        const result = await uploadSchemeImagesToTrip(bridge, batches[i]!)
        if (!result.ok) {
          throw new Error(result.error || 'Ошибка загрузки')
        }
        uploaded += result.uploaded ?? batches[i]!.length
      }
      setStatus(`Готово: загружено файлов ${uploaded}`)
      const open = window.confirm(
        `Схемы отправлены в выезд (${uploaded} файл/ов).\nОткрыть карточку выезда?`,
      )
      if (open && bridge.returnTripUrl) {
        window.open(bridge.returnTripUrl, '_blank', 'noopener,noreferrer')
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Не удалось отправить схемы'
      setStatus(message)
      window.alert(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="no-print shrink-0 border-b border-violet-300 bg-violet-50 px-4 py-2.5 sm:px-6"
      role="status"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-medium text-violet-950">
          Выезд: {bridge.title || 'без названия'}
          {dateLabel ? ` · ${dateLabel}` : ''}
          {bridge.time ? ` ${bridge.time}` : ''}
          {bridge.car ? ` · רכב ${bridge.car}` : ''}
          {' · '}
          <span className="font-mono text-xs text-violet-800" title={bridge.tripId}>
            trip {tripShort}
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void sendSchemes()}
            className="touch-manipulation rounded-lg border border-violet-400 bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:opacity-60"
          >
            {busy ? 'Отправка…' : 'Отправить все схемы'}
          </button>
          <button
            type="button"
            disabled={!bridge.returnTripUrl || busy}
            onClick={openCard}
            className="touch-manipulation rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-xs font-medium text-violet-900 transition hover:bg-violet-100 disabled:opacity-50"
          >
            Открыть карточку выезда
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onDetach}
            className="touch-manipulation rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Отвязать
          </button>
        </div>
      </div>
      {status && <p className="mt-1 text-xs text-violet-800">{status}</p>}
    </div>
  )
}
