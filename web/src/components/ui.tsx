import { Link } from 'react-router-dom'

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

export function Badge({ color, children }: { color?: string; children: React.ReactNode }) {
  return (
    <span className="badge" style={color ? { background: `${color}22`, color } : undefined}>
      {children}
    </span>
  )
}