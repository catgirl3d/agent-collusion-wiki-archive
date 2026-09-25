import { createElement } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import type { SortState } from '../utils/sort'
import { fmtInt } from '../utils/format'

type TextLinkProps = LinkProps & { className?: string }

export function TextLink({ className, ...props }: TextLinkProps) {
  const classes = ['link', className].filter(Boolean).join(' ')
  return <Link {...props} className={classes} />
}

export function PageLink({ id, name, max }: { id: string; name: string; max?: number }) {
  const short = max && name.length > max ? `${name.slice(0, max)}…` : name
  return (
    <TextLink to={`/page/${encodeURIComponent(id)}`} title={name}>
      {short}
    </TextLink>
  )
}

type ChipProps = React.HTMLAttributes<HTMLSpanElement> & {
  children: React.ReactNode
  tone?: 'plain' | 'del' | 'wiki'
}

export function Chip({ children, tone = 'plain', className, ...props }: ChipProps) {
  const classes = ['chip', `chip-${tone}`, className].filter(Boolean).join(' ')
  return <span {...props} className={classes}>{children}</span>
}

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  color?: string
  children: React.ReactNode
}

export function Badge({ color, className, style, children, ...props }: BadgeProps) {
  const classes = ['badge', className].filter(Boolean).join(' ')
  const colorStyle = color ? { background: `${color}22`, color } : undefined
  return (
    <span {...props} className={classes} style={colorStyle || style ? { ...colorStyle, ...style } : undefined}>
      {children}
    </span>
  )
}

type CardTag = 'div' | 'section' | 'article' | 'nav' | 'aside'

type CardProps = React.HTMLAttributes<HTMLElement> & {
  as?: CardTag
  className?: string
  ref?: React.Ref<HTMLElement>
  variant?: 'default' | 'compact'
}

export function Card({ as: Element = 'div', className, ref, variant = 'default', ...props }: CardProps) {
  const classes = ['card', variant === 'compact' && 'card-compact', className].filter(Boolean).join(' ')
  return createElement(Element, { ...props, className: classes, ref })
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
      <button type="button" className="th-sort" onClick={() => { onToggle(sortKey); }}>
        {label}
        {arrow ? <span className="sort-arrow" aria-hidden="true">{arrow}</span> : null}
      </button>
    </th>
  )
}

interface ButtonCommonProps {
  variant?: 'primary' | 'ghost'
  size?: 'md' | 'sm' | 'xs' | 'icon'
  className?: string
  children: React.ReactNode
}

type ButtonNativeProps = ButtonCommonProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> &
  { ref?: React.Ref<HTMLButtonElement> }

type ButtonLinkProps = ButtonCommonProps & { to: string } & Omit<LinkProps, 'to' | 'className' | 'children'>
type ButtonAnchorProps = ButtonCommonProps & { href: string } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'className' | 'children'>

export function Button(props: ButtonLinkProps | ButtonAnchorProps | ButtonNativeProps): React.ReactElement
export function Button({ variant = 'primary', size = 'md', className, children, ...rest }: ButtonLinkProps | ButtonAnchorProps | ButtonNativeProps) {
  const classes = ['btn', variant === 'ghost' && 'ghost', size !== 'md' && size, className].filter(Boolean).join(' ')
  if ('to' in rest) {
    const { to, ...linkProps } = rest
    return <Link to={to} className={classes} {...linkProps}>{children}</Link>
  }
  if ('href' in rest) {
    const { href, ...anchorProps } = rest
    return <a href={href} className={classes} {...anchorProps}>{children}</a>
  }
  return <button type="button" className={classes} {...rest}>{children}</button>
}

const SCROLL_TOP_LABEL = 'Scroll to top'

type ScrollTopButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className' | 'onClick' | 'size' | 'type'> & {
  children?: React.ReactNode
  className?: string
  onClick?: React.MouseEventHandler<HTMLButtonElement>
  size?: ButtonCommonProps['size']
}

export function ScrollTopButton({
  children,
  className,
  onClick,
  size = 'md',
  ...rest
}: ScrollTopButtonProps) {
  // The accessible label is pinned only to the default content: custom children
  // keep their own accessible name so the visible text and the name never diverge.
  return (
    <Button
      variant="ghost"
      size={size}
      className={className}
      aria-label={children === undefined ? SCROLL_TOP_LABEL : undefined}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
        window.scrollTo({ top: 0, behavior: 'smooth' })
        onClick?.(event)
      }}
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
