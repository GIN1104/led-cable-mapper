import { useCallback } from 'react'
import type { EquipmentListMeta, EquipmentListRow, EquipmentListState } from '../lib/equipmentList'
import { equipmentListToXlsxBlob } from '../lib/equipmentList'
import CollapsibleSection from './CollapsibleSection'

interface EquipmentListTableProps {
  state: EquipmentListState
  onChange: (next: EquipmentListState) => void
  onRefreshFromRouting: () => void
}

function MetaField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium text-slate-600">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-slate-200 px-2.5 py-1.5 text-slate-800 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
      />
    </label>
  )
}

export default function EquipmentListTable({
  state,
  onChange,
  onRefreshFromRouting,
}: EquipmentListTableProps) {
  const updateMeta = useCallback(
    (patch: Partial<EquipmentListMeta>) => {
      onChange({ ...state, meta: { ...state.meta, ...patch } })
    },
    [onChange, state],
  )

  const updateRow = useCallback(
    (id: string, patch: Partial<EquipmentListRow>) => {
      onChange({
        ...state,
        rows: state.rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
      })
    },
    [onChange, state],
  )

  const handleExportXlsx = useCallback(async () => {
    const blob = await equipmentListToXlsxBlob(state)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `equipment-list-${state.meta.eventName || 'event'}.xlsx`
    anchor.click()
    URL.revokeObjectURL(url)
  }, [state])

  return (
    <CollapsibleSection
      title="רשימת ציוד לאירוע"
      titleExtra={
        <span className="font-normal text-slate-400"> (לדים · LED equipment)</span>
      }
      defaultExpanded={false}
    >
      <div className="space-y-4 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <MetaField
            label="תאריך (дата)"
            value={state.meta.eventDate}
            onChange={(eventDate) => updateMeta({ eventDate })}
          />
          <MetaField
            label="שם האירוע (название события)"
            value={state.meta.eventName}
            onChange={(eventName) => updateMeta({ eventName })}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRefreshFromRouting}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Обновить авто-поля из маршрутизации
          </button>
          <button
            type="button"
            onClick={() => void handleExportXlsx()}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Экспорт Excel (.xlsx)
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-slate-500">
                <th className="px-3 py-2.5 font-semibold">ציוד</th>
                <th className="px-3 py-2.5 font-semibold">Оборудование</th>
                <th className="w-40 px-3 py-2.5 font-semibold">כמויות</th>
                <th className="w-28 px-3 py-2.5 font-semibold">תופסות</th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((row) => {
                const isScreenRow = row.id === 'screen'
                const screenLineCount = row.quantity ? row.quantity.split('\n').length : 1

                return (
                  <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="px-3 py-1.5 font-medium text-slate-800" dir="rtl">
                      {row.hebrew}
                      {row.autoKey && (
                        <span
                          className="ms-1 text-[10px] font-normal text-blue-500"
                          title="Автозаполнение из маршрутизации"
                        >
                          auto
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-slate-600">{row.russian}</td>
                    <td className="px-3 py-1.5">
                      {isScreenRow ? (
                        <textarea
                          rows={Math.max(2, screenLineCount)}
                          value={row.quantity}
                          onChange={(e) =>
                            updateRow(row.id, {
                              quantity: e.target.value,
                              quantityManual: true,
                            })
                          }
                          placeholder="Screen 1: 10×3m (60 cab, 10 cases)"
                          className="w-full rounded border border-slate-200 px-2 py-1 font-mono text-[11px] leading-snug text-slate-800 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                      ) : (
                        <input
                          type="text"
                          inputMode="numeric"
                          value={row.quantity}
                          onChange={(e) =>
                            updateRow(row.id, {
                              quantity: e.target.value,
                              quantityManual: true,
                            })
                          }
                          className="w-full rounded border border-slate-200 px-2 py-1 text-slate-800 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="text"
                        value={row.footprint}
                        onChange={(e) =>
                          updateRow(row.id, {
                            footprint: e.target.value,
                            footprintManual: true,
                          })
                        }
                        className="w-full rounded border border-slate-200 px-2 py-1 text-slate-800 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                        dir="rtl"
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3">
          <MetaField
            label="מיקום (локация)"
            value={state.meta.location}
            onChange={(location) => updateMeta({ location })}
          />
          <MetaField
            label="שעות (часы)"
            value={state.meta.hours}
            onChange={(hours) => updateMeta({ hours })}
          />
          <MetaField
            label="איש קשר (контакт)"
            value={state.meta.contact}
            onChange={(contact) => updateMeta({ contact })}
          />
        </div>
      </div>
    </CollapsibleSection>
  )
}
