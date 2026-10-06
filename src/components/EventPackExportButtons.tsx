import { useState } from 'react'
import {
  downloadFullEventWorkbook,
  getFullEventXlsxFilename,
  buildFullEventWorkbook,
  type EquipmentListState,
} from '../lib/equipmentList'
import { uploadBlobToGoogleDrive } from '../lib/googleDrive'
import type { TripBridge } from '../lib/tripBridge'
import { resolveReturnTripCardUrl } from '../lib/tripBridge'
import {
  chunkFiles,
  collectSchemePngFiles,
  prepareSchemeBridge,
  uploadSchemeImagesToTrip,
} from '../lib/tripUpload'

interface EventPackExportButtonsProps {
  state: EquipmentListState
  /** Не давать клику всплыть (кнопки в шапке сворачиваемой секции) */
  stopPropagation?: boolean
  compact?: boolean
  /** Активный deep-link выезда — кнопка «Отправить схемы в выезд» */
  tripBridge?: TripBridge | null
}

export default function EventPackExportButtons({
  state,
  stopPropagation = false,
  compact = false,
  tripBridge = null,
}: EventPackExportButtonsProps) {
  const [busy, setBusy] = useState<'excel' | 'drive' | 'trip' | null>(null)

  const run = async (kind: 'excel' | 'drive') => {
    if (busy) return
    setBusy(kind)
    try {
      if (kind === 'excel') {
        await downloadFullEventWorkbook(state)
        return
      }
      const blob = await buildFullEventWorkbook(state)
      const link = await uploadBlobToGoogleDrive(blob, getFullEventXlsxFilename(state.meta))
      window.alert(`Файл сохранён в Google Drive.\n${link}`)
    } catch (error) {
      if (error instanceof Error && error.message === 'cancelled') return
      window.alert(
        error instanceof Error ? error.message : 'Не удалось сохранить файл',
      )
    } finally {
      setBusy(null)
    }
  }

  const sendToTrip = async () => {
    if (busy || !tripBridge) return
    const firstHandle = prepareSchemeBridge()
    setBusy('trip')
    try {
      const files = await collectSchemePngFiles(state.meta.eventName || tripBridge.title)
      const batches = chunkFiles(files, 5)
      let uploaded = 0
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i]!
        const handle = i === 0 ? firstHandle : prepareSchemeBridge()
        const result = await uploadSchemeImagesToTrip(tripBridge, batch, handle)
        if (!result.ok) throw new Error(result.error || 'Ошибка загрузки')
        uploaded += result.uploaded ?? batch.length
      }
      const open = window.confirm(
        `Схемы отправлены в выезд (${uploaded} файл/ов).\nОткрыть карточку выезда?`,
      )
      const cardUrl = resolveReturnTripCardUrl(tripBridge)
      if (open && cardUrl) {
        window.open(cardUrl, '_blank', 'noopener,noreferrer')
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Не удалось отправить схемы')
    } finally {
      setBusy(null)
    }
  }

  const pad = compact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2.5 text-sm'
  const excelClass = `touch-manipulation rounded-lg border border-emerald-300 bg-white font-medium text-emerald-900 shadow-sm transition hover:bg-emerald-50 disabled:opacity-60 ${pad}`
  const driveClass = `touch-manipulation rounded-lg border border-sky-300 bg-sky-50 font-medium text-sky-900 shadow-sm transition hover:bg-sky-100 disabled:opacity-60 ${pad}`
  const tripClass = `touch-manipulation rounded-lg border border-violet-400 bg-violet-700 font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:opacity-60 ${pad}`

  return (
    <>
      <button
        type="button"
        disabled={busy != null}
        className={excelClass}
        title="Один Excel: список оборудования, под ним тикшорет и хашмаль"
        onClick={(event) => {
          if (stopPropagation) event.stopPropagation()
          void run('excel')
        }}
      >
        {busy === 'excel' ? 'Сбор схем…' : 'Excel + схемы'}
      </button>
      <button
        type="button"
        disabled={busy != null}
        className={driveClass}
        title="Сохранить тот же файл (список + схемы) в Google Drive"
        onClick={(event) => {
          if (stopPropagation) event.stopPropagation()
          void run('drive')
        }}
      >
        {busy === 'drive' ? 'Google Drive…' : 'Google Drive'}
      </button>
      {tripBridge && (
        <button
          type="button"
          disabled={busy != null}
          className={tripClass}
          title="PNG схем Data/Power → карточка выезда (Apps Script)"
          onClick={(event) => {
            if (stopPropagation) event.stopPropagation()
            void sendToTrip()
          }}
        >
          {busy === 'trip' ? 'Отправка…' : 'Отправить все схемы'}
        </button>
      )}
    </>
  )
}
