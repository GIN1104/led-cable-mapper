import type { PackingListItem } from '../types'
import CollapsibleSection from './CollapsibleSection'

interface PackingListViewProps {
  items: PackingListItem[]
  title?: string
}

export default function PackingListView({ items, title }: PackingListViewProps) {
  return (
    <CollapsibleSection
      title={title ?? 'Packing List'}
      titleExtra={
        <span className="font-normal text-slate-400"> (+10% spare)</span>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[280px] text-left text-xs sm:min-w-0">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-slate-500">
              <th className="px-4 py-2.5 font-semibold">Item</th>
              <th className="px-4 py-2.5 font-semibold">Qty</th>
              <th className="px-4 py-2.5 font-semibold">Notes</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr
                key={i}
                className="border-b border-slate-50 hover:bg-slate-50/80"
              >
                <td className="px-4 py-2 font-medium text-slate-800">
                  {item.item}
                </td>
                <td className="px-4 py-2 text-slate-700">{item.quantity}</td>
                <td className="px-4 py-2 text-slate-500">{item.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleSection>
  )
}
