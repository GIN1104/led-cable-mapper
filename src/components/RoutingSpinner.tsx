interface RoutingSpinnerProps {
  label?: string
  cabinetCount?: number
}

export default function RoutingSpinner({
  label = 'Расчёт маршрутизации…',
  cabinetCount,
}: RoutingSpinnerProps) {
  return (
    <div
      className="flex min-h-[12rem] flex-col items-center justify-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-6 py-10"
      role="status"
      aria-live="polite"
    >
      <div
        className="h-9 w-9 animate-spin rounded-full border-[3px] border-slate-200 border-t-blue-600"
        aria-hidden
      />
      <p className="text-sm font-medium text-slate-700">{label}</p>
      {cabinetCount != null && cabinetCount >= 100 && (
        <p className="text-xs text-slate-500">
          {cabinetCount} кабинетов — это может занять секунду
        </p>
      )}
    </div>
  )
}
