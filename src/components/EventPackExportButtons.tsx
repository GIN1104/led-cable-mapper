import { useState } from 'react'
import {
  downloadFullEventWorkbook,
  type EquipmentListState,
} from '../lib/equipmentList'
import type { TripBridge } from '../lib/tripBridge'
import { openReturnTripCard } from '../lib/tripBridge'
import {
  publishEventWorkbookEditLink,
  sendAllSchemes,
  type TripScreenCaptureTarget,
} from '../lib/tripUpload'

interface EventPackExportButtonsProps {
  state: EquipmentListState
  /** Не давать клику всплыть (кнопки в шапке сворачиваемой секции) */
  stopPropagation?: boolean
  compact?: boolean
  /** Активный deep-link выезда — кнопка «Отправить схемы в выезд» */
  tripBridge?: TripBridge | null
  screens?: TripScreenCaptureTarget[]
  activeScreenId?: string
  onActivateScreen?: (id: string) => void
}

export default function EventPackExportButtons({
  state,
  stopPropagation = false,
  compact = false,
  tripBridge = null,
  screens = [],
  activeScreenId = '',
  onActivateScreen,
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
      const link = await publishEventWorkbookEditLink(state)
      window.alert(`Excel на Google Drive. Ссылка для правки:\n${link}`)
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
    setBusy('trip')
    try {
      const screenCapture =
        screens.length > 0 && activeScreenId && onActivateScreen
          ? {
              screens,
              activeScreenId,
              activateScreen: onActivateScreen,
            }
          : undefined
      const result = await sendAllSchemes(
        tripBridge,
        state,
        state.meta.eventName || tripBridge.title,
        screenCapture,
      )
      const open = window.confirm(
        `В выезд отправлено файлов: ${result.uploaded}.\n` +
          (result.editLink
            ? result.linkInTrip
              ? `Ссылка на Excel (открыть Excel.html и нажать):\n${result.editLink}\n\n`
              : `Карточка не приняла кликабельный файл. Адрес на картинке и здесь:\n${result.editLink}\n\n`
            : '\n') +
          `Открыть карточку выезда?`,
      )
      if (open) {
        openReturnTripCard(tripBridge)
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'cancelled') return
      window.alert(
        error instanceof Error ? error.message : 'Не удалось отправить файлы в выезд',
      )
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
        title="Excel на Google Drive: обратно только ссылка с правом править"
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
          title="В выезд: PNG схем и кликабельная ссылка на Excel в LED Warehouse / Excel"
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
