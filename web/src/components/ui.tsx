import { Link, type LinkProps } from 'react-router-dom'
import type { SortState } from '../utils/sort'
import { fmtInt } from '../utils/format'

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

type ButtonCommonProps = {
  variant?: 'primary' | 'ghost'
  size?: 'md' | 'sm'
  className?: string
  children: React.ReactNode
}

type ButtonNativeProps = ButtonCommonProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>

type ButtonLinkProps = ButtonCommonProps & { to: string } & Omit<LinkProps, 'to' | 'className' | 'children'>

export function Button(props: ButtonLinkProps): React.ReactElement
export function Button(props: ButtonNativeProps): React.ReactElement
export function Button({ variant = 'primary', size = 'md', className, children, ...rest }: ButtonLinkProps | ButtonNativeProps) {
  const classes = ['btn', variant === 'ghost' && 'ghost', size === 'sm' && 'sm', className].filter(Boolean).join(' ')
  if ('to' in rest) {
    const { to, ...linkProps } = rest
    return <Link to={to} className={classes} {...linkProps}>{children}</Link>
  }
  return <button type="button" className={classes} {...rest}>{children}</button>
}

const SCROLL_TOP_LABEL = 'Scroll to top'

export function ScrollTopButton({
  children,
  className,
  ...rest
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className' | 'onClick' | 'type'> & {
  children?: React.ReactNode
  className?: string
}) {
  // The accessible label is pinned only to the default content: custom children
  // keep their own accessible name so the visible text and the name never diverge.
  return (
    <Button
      variant="ghost"
      className={className}
      aria-label={children === undefined ? SCROLL_TOP_LABEL : undefined}
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      {...rest}
    >
      {children ?? (<><span aria-hidden="true">↑ </span>top</>)}
    </Button>
  )
}

export function LoadMore({
  loaded,
  total,
  onLoadMore,
  step = 50,
  unit = 'left',
  label,
  action = 'Load more',
  showScrollTop = true,
  loading = false,
  disabled = false,
}: {
  loaded: number
  total: number
  onLoadMore: () => void
  step?: number
  unit?: string
  label?: string
  action?: string
  showScrollTop?: boolean
  loading?: boolean
  disabled?: boolean
}) {
  const remaining = Math.max(0, total - loaded)
  const hasMore = remaining > 0
  const canScrollTop = showScrollTop && loaded > step

  if (!hasMore && !canScrollTop) return null

  return (
    <div className="load-more-row">
      {hasMore && (
        <Button onClick={onLoadMore} disabled={disabled || loading} aria-busy={loading || undefined}>
          {loading ? 'Loading…' : (label ?? `${action} (${fmtInt(remaining)} ${unit})`)}
        </Button>
      )}
      {canScrollTop && <ScrollTopButton />}
    </div>
  )
}

