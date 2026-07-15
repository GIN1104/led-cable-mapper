import type { CableScheduleEntry } from '../types'
import CollapsibleSection from './CollapsibleSection'

interface CableScheduleTableProps {
  entries: CableScheduleEntry[]
  title?: string
}

const TYPE_BADGE: Record<CableScheduleEntry['lineType'], string> = {
  Data: 'bg-blue-100 text-blue-800',
  'Data Backup': 'bg-green-100 text-green-800',
  Power: 'bg-red-100 text-red-800',
}

export default function CableScheduleTable({
  entries,
  title = 'Cable Schedule',
}: CableScheduleTableProps) {
  return (
    <CollapsibleSection title={title} defaultExpanded={false}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs sm:min-w-[900px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-slate-500">
              <th className="px-4 py-2.5 font-semibold">Cable ID</th>
              <th className="px-4 py-2.5 font-semibold">Type</th>
              <th className="px-4 py-2.5 font-semibold">Source → Destination</th>
              <th className="px-4 py-2.5 font-semibold">Cable &amp; Connectors</th>
              <th className="px-4 py-2.5 font-semibold">Length</th>
              <th className="px-4 py-2.5 font-semibold">Qty</th>
              <th className="px-4 py-2.5 font-semibold">Color Coding</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr
                key={entry.cableId}
                className="border-b border-slate-50 hover:bg-slate-50/80"
              >
                <td className="px-4 py-2 font-mono font-medium text-slate-800">
                  {entry.cableId}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${TYPE_BADGE[entry.lineType]}`}
                  >
                    {entry.lineType}
                  </span>
                </td>
                <td className="px-4 py-2 text-slate-700">
                  {entry.source} → {entry.destination}
                </td>
                <td className="px-4 py-2 text-slate-600">{entry.cableType}</td>
                <td className="px-4 py-2 text-slate-600">{entry.lengthM}m</td>
                <td className="px-4 py-2 text-slate-600">{entry.quantity}</td>
                <td className="px-4 py-2 text-slate-500">{entry.colorAdvice}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleSection>
  )
}
