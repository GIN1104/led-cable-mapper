import type { ScreenConfig } from '../types'

interface ScreenManagerProps {
  screens: ScreenConfig[]
  activeScreenId: string
  onSelect: (id: string) => void
  onAdd: () => void
  onRemove: (id: string) => void
  onRename: (id: string, name: string) => void
}

export default function ScreenManager({
  screens,
  activeScreenId,
  onSelect,
  onAdd,
  onRemove,
  onRename,
}: ScreenManagerProps) {
  const canRemove = screens.length > 1

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Screens / Экраны
        </h2>
        <button
          type="button"
          onClick={onAdd}
          className="touch-manipulation min-h-[44px] rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 sm:min-h-0 sm:px-2 sm:py-1 sm:text-[10px]"
          title="Add screen"
        >
          + Add
        </button>
      </div>

      <div className="space-y-2">
        {screens.map((screen) => {
          const isActive = screen.id === activeScreenId
          return (
            <div
              key={screen.id}
              className={`flex flex-col gap-2 rounded-lg border px-3 py-2.5 transition sm:flex-row sm:items-center sm:gap-1.5 sm:px-2 sm:py-1.5 ${
                isActive
                  ? 'border-blue-300 bg-blue-50 ring-1 ring-blue-200'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(screen.id)}
                className="touch-manipulation min-w-0 flex-1 text-left text-sm font-medium text-slate-800 sm:text-xs"
              >
                {screen.name}
                <span className="mt-0.5 block text-xs font-normal text-slate-400 sm:ml-1 sm:mt-0 sm:inline sm:text-[10px]">
                  {screen.wallWidthM}×{screen.wallHeightM} m · {screen.cabinetsWide}×
                  {screen.cabinetsHigh}
                </span>
              </button>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={screen.name}
                  onChange={(e) => onRename(screen.id, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  className="min-h-[44px] min-w-0 flex-1 rounded border border-slate-200 px-2 py-2 text-sm focus:border-blue-500 focus:outline-none sm:min-h-0 sm:w-24 sm:flex-none sm:px-1.5 sm:py-0.5 sm:text-[10px]"
                  aria-label={`Rename ${screen.name}`}
                />
                {canRemove && (
                  <button
                    type="button"
                    onClick={() => onRemove(screen.id)}
                    className="touch-manipulation min-h-[44px] min-w-[44px] rounded px-2 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 sm:min-h-0 sm:min-w-0 sm:px-1.5 sm:py-0.5 sm:text-[10px]"
                    title="Remove screen"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
