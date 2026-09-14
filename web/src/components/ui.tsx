import { Link } from 'react-router-dom'
import type { SortState } from '../utils/sort'

export function PageLink({ id, name, max }: { id: string; name: string; max?: number }) {
  const short = max && name.length > max ? `${name.slice(0, max)}…` : name
  return (
    <Link className="link" to={`/page/${encodeURIComponent(id)}`} title={name}>
      {short}
    </Link>
  )
}

export function Chip({ children, tone = 'plain' }: { children: React.ReactNode; tone?: 'plain' | 'del' | 'wiki' }) {
  return <span className={`chip chip-${tone}`}>{children}</span>
}

export function Badge({
  color,
  className,
  title,
  children,
}: {
  color?: string
  className?: string
  title?: string
  children: React.ReactNode
}) {
  return (
    <span className={`badge${className ? ` ${className}` : ''}`} title={title} style={color ? { background: `${color}22`, color } : undefined}>
      {children}
    </span>
  )
}

export function SortHeader<K extends string>({
  label,
  sortKey,
  current,
  numeric = false,
  onToggle,
}: {
  label: string
  sortKey: K
  current: SortState<K>
  numeric?: boolean
  onToggle: (key: K) => void
}) {
  const active = current.sort === sortKey
  const activeDir = active ? current.dir : undefined
  const ariaSort = activeDir === 'asc' ? 'ascending' : activeDir === 'desc' ? 'descending' : undefined
  const arrow = activeDir === 'asc' ? '▴' : activeDir === 'desc' ? '▾' : ''
  return (
    <th scope="col" aria-sort={ariaSort} className={numeric ? 'num' : undefined}>
      <button type="button" className="th-sort" onClick={() => onToggle(sortKey)}>
        {label}
        {arrow ? <span className="sort-arrow" aria-hidden="true">{arrow}</span> : null}
      </button>
    </th>
  )
}
