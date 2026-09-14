import { Link, type LinkProps } from 'react-router-dom'
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
