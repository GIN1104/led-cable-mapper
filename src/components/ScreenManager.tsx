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

      <div className="flex items-center justify-between">

        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">

          Screens / Экраны

        </h2>

        <button

          type="button"

          onClick={onAdd}

          className="rounded-md bg-blue-600 px-2 py-1 text-[10px] font-semibold text-white shadow-sm transition hover:bg-blue-700"

          title="Add screen"

        >

          + Add

        </button>

      </div>



      <div className="space-y-1.5">

        {screens.map((screen) => {

          const isActive = screen.id === activeScreenId

          return (

            <div

              key={screen.id}

              className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 transition ${

                isActive

                  ? 'border-blue-300 bg-blue-50 ring-1 ring-blue-200'

                  : 'border-slate-200 bg-white hover:border-slate-300'

              }`}

            >

              <button

                type="button"

                onClick={() => onSelect(screen.id)}

                className="min-w-0 flex-1 truncate text-left text-xs font-medium text-slate-800"

              >

                {screen.name}

                <span className="ml-1 text-[10px] font-normal text-slate-400">

                  {screen.wallWidthM}×{screen.wallHeightM} m · {screen.cabinetsWide}×

                  {screen.cabinetsHigh}

                </span>

              </button>

              <input

                type="text"

                value={screen.name}

                onChange={(e) => onRename(screen.id, e.target.value)}

                onClick={(e) => e.stopPropagation()}

                className="w-20 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] focus:border-blue-500 focus:outline-none"

                aria-label={`Rename ${screen.name}`}

              />

              {canRemove && (

                <button

                  type="button"

                  onClick={() => onRemove(screen.id)}

                  className="rounded px-1.5 py-0.5 text-[10px] font-medium text-red-600 transition hover:bg-red-50"

                  title="Remove screen"

                >

                  ×

                </button>

              )}

            </div>

          )

        })}

      </div>

    </section>

  )

}


