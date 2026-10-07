import { useState } from 'react'
import type { EquipmentListState } from '../lib/equipmentList'
import type { TripBridge } from '../lib/tripBridge'
import {
  formatTripDateForMeta,
  openReturnTripCard,
  resolveReturnTripCardUrl,
} from '../lib/tripBridge'
import {
  chunkFiles,
  collectTripPackFiles,
  diagnoseTripUpload,
  downloadSchemeFilesLocally,
  prepareSchemeBridge,
  uploadSchemeImagesToTrip,
} from '../lib/tripUpload'

interface TripBridgeBannerProps {
  bridge: TripBridge
  eventName?: string
  /** Список оборудования — нужен для отправки Excel вместе со схемами */
  equipmentList?: EquipmentListState | null
  onDetach: () => void
}

export default function TripBridgeBanner({
  bridge,
  eventName,
  equipmentList = null,
  onDetach,
}: TripBridgeBannerProps) {
  const [busy, setBusy] = useState<'send' | 'diag' | 'local' | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const dateLabel = formatTripDateForMeta(bridge.date) || bridge.date
  const tripShort =
    bridge.tripId.length > 12 ? `${bridge.tripId.slice(0, 8)}…` : bridge.tripId
  const cardUrl = resolveReturnTripCardUrl(bridge)

  const openCard = () => {
    if (!openReturnTripCard(bridge)) {
      window.alert('В ссылке нет return_trip_url — карточку выезда открыть нельзя.')
    }
  }

  const saveLocal = async () => {
    if (busy) return
    setBusy('local')
    setStatus(equipmentList ? 'Сборка Excel и PNG…' : 'Скачивание PNG…')
    try {
      const files = await collectTripPackFiles(equipmentList, eventName || bridge.title)
      const n = await downloadSchemeFilesLocally(files)
      setStatus(`Скачано локально: ${n} файл/ов`)
      window.alert(
        `Сохранено на диск: ${n} файл/ов.\n(В карточку выезда это не попадает — только локально.)`,
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Не удалось сохранить файлы'
      setStatus(message)
      window.alert(message)
    } finally {
      setBusy(null)
    }
  }

  const runDiagnose = async () => {
    if (busy) return
    setBusy('diag')
    setStatus('Диагностика upload…')
    try {
      const { summary, verdict } = await diagnoseTripUpload(bridge)
      setStatus(verdict.slice(0, 180) + (verdict.length > 180 ? '…' : ''))
      window.alert(summary)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Диагностика не удалась'
      setStatus(message)
      window.alert(message)
      console.error('[TripUpload DIAG]', error)
    } finally {
      setBusy(null)
    }
  }

  const sendSchemes = async () => {
    if (busy) return
    const bridgeHandle = prepareSchemeBridge()
    setBusy('send')
    setStatus(null)
    try {
      const withExcel = Boolean(equipmentList)
      setStatus(withExcel ? 'Сборка Excel и схем…' : 'Снимки схем…')
      const files = await collectTripPackFiles(equipmentList, eventName || bridge.title)
      const batches = chunkFiles(files, 5)
      let uploaded = 0
      for (let i = 0; i < batches.length; i++) {
        setStatus(
          batches.length > 1
            ? `Отправка ${i + 1}/${batches.length}…`
            : withExcel
              ? 'Отправка Excel и схем…'
              : 'Отправка схем…',
        )
        const handle = i === 0 ? bridgeHandle : prepareSchemeBridge()
        const result = await uploadSchemeImagesToTrip(bridge, batches[i]!, handle)
        if (!result.ok) {
          throw new Error(result.error || 'Ошибка загрузки')
        }
        uploaded += result.uploaded ?? batches[i]!.length
      }
      setStatus(`Готово: загружено файлов ${uploaded}`)
      const open = window.confirm(
        `${withExcel ? 'Excel и схемы' : 'Схемы'} отправлены в выезд (${uploaded} файл/ов).\nОткрыть карточку выезда?`,
      )
      if (open) {
        openReturnTripCard(bridge)
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Не удалось отправить Excel и схемы'
      setStatus(message)
      const save = window.confirm(
        `${message}\n\nОбойти отказ токена GAS с клиента нельзя.\nСкачать Excel и PNG на этот компьютер сейчас?`,
      )
      if (save) {
        try {
          const files = await collectTripPackFiles(
            equipmentList,
            eventName || bridge.title,
          )
          const n = await downloadSchemeFilesLocally(files)
          setStatus(`${message} · скачано локально ${n} файл/ов`)
          window.alert(`Скачано локально: ${n} файл/ов`)
        } catch (saveError) {
          window.alert(
            saveError instanceof Error ? saveError.message : 'Не удалось скачать файлы',
          )
        }
      } else {
        window.alert(message)
      }
    } finally {
      setBusy(null)
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
            disabled={busy != null}
            onClick={() => void sendSchemes()}
            title="Excel (список + схемы) и PNG Data/Power → карточка выезда"
            className="touch-manipulation rounded-lg border border-violet-400 bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:opacity-60"
          >
            {busy === 'send' ? 'Отправка…' : 'Отправить все схемы'}
          </button>
          <button
            type="button"
            disabled={busy != null}
            onClick={() => void runDiagnose()}
            className="touch-manipulation rounded-lg border border-amber-400 bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-950 transition hover:bg-amber-200 disabled:opacity-60"
          >
            {busy === 'diag' ? 'Диагностика…' : 'Диагностика GAS'}
          </button>
          <button
            type="button"
            disabled={busy != null}
            onClick={() => void saveLocal()}
            className="touch-manipulation rounded-lg border border-emerald-400 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-900 transition hover:bg-emerald-100 disabled:opacity-60"
          >
            {busy === 'local' ? 'Скачивание…' : 'Скачать PNG'}
          </button>
          <button
            type="button"
            disabled={!cardUrl || busy != null}
            onClick={openCard}
            title="Открыть карточку проекта текущего выезда (trip)"
            className="touch-manipulation rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-xs font-medium text-violet-900 transition hover:bg-violet-100 disabled:opacity-50"
          >
            Открыть карточку выезда
          </button>
          <button
            type="button"
            disabled={busy != null}
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
