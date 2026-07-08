import CollapsibleSection from './CollapsibleSection'

interface RoutingSchemaProps {
  lines: string[]
}

export default function RoutingSchema({ lines }: RoutingSchemaProps) {
  return (
    <CollapsibleSection title="Text Routing Schema">
      <pre className="overflow-x-auto whitespace-pre-wrap px-4 py-4 font-mono text-xs leading-relaxed text-slate-700 sm:px-5">
        {lines.join('\n')}
      </pre>
    </CollapsibleSection>
  )
}
