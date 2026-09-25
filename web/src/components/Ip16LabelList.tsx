import { useState } from 'react'
import { Button } from './ui'
import { fmtInt } from '../utils/format'
import { IP16_TOP_LABELS, type Ip16LabelStat } from '../utils/ip16'

/**
 * The clickable label badges of an ip16 dossier, shared by /timeline and /agents.
 * What a click does is page-specific and lives in `onPickLabel`.
 */
export function Ip16LabelList({
  stats,
  activeLabel,
  onPickLabel,
  ariaLabel,
}: {
  stats: Ip16LabelStat[]
  activeLabel: string
  onPickLabel: (label: string) => void
  ariaLabel: string
}) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? stats : stats.slice(0, IP16_TOP_LABELS)
  const hidden = stats.length - shown.length

  return (
    <div className={`ip16-labels${expanded ? ' is-expanded' : ''}`} role="group" aria-label={ariaLabel}>
      {shown.map((stat) => {
        const active = stat.x === activeLabel
        return (
          <Button
            key={stat.x}
            type="button"
            variant="ghost"
            size="sm"
            className={`ip16-label${active ? ' active' : ''}`}
            aria-pressed={active}
            title={active ? 'Clear the label filter' : `Filter the table by ${stat.x}`}
            onClick={() => { onPickLabel(stat.x); }}
          >
            <span>{stat.x}</span>
            <span className="n">{fmtInt(stat.n)}</span>
          </Button>
        )
      })}
      {hidden > 0 && (
        <Button type="button" variant="ghost" size="sm" className="ip16-label ip16-label-more" onClick={() => { setExpanded(true); }}>
          +{fmtInt(hidden)} more
        </Button>
      )}
      {expanded && stats.length > IP16_TOP_LABELS && (
        <Button type="button" variant="ghost" size="sm" className="ip16-label ip16-label-more" onClick={() => { setExpanded(false); }}>
          show top {IP16_TOP_LABELS}
        </Button>
      )}
    </div>
  )
}
