import { useState, type ReactNode } from 'react'

/**
 * The main left-hand panel. On narrow screens it becomes a bottom sheet that
 * can be collapsed to its header so the map stays usable.
 */
export function SidePanel({ title, aside, footer, children, className = '' }: { title: ReactNode; aside?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string }) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <section className={`panel side-panel ${collapsed ? 'collapsed' : ''} ${className}`}>
      <button className="sheet-handle" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}>
        <span />
      </button>
      <header className="panel-head">
        <h2>{title}</h2>
        {aside}
      </header>
      <div className="panel-body">{children}</div>
      {footer && <footer className="panel-foot">{footer}</footer>}
    </section>
  )
}

/** Horizontal bar with a filled share. */
export function Bar({ value, color = 'var(--green)', label, right }: { value: number; color?: string; label?: ReactNode; right?: ReactNode }) {
  const v = Math.max(0, Math.min(1, value))
  return (
    <div className="bar-row">
      {(label || right) && (
        <div className="bar-label">
          <span>{label}</span>
          <span className="num">{right}</span>
        </div>
      )}
      <div className="bar">
        <div className="bar-fill" style={{ width: `${v * 100}%`, background: color }} />
      </div>
    </div>
  )
}

export function Swatch({ color, shape = 'dot' }: { color: string; shape?: 'dot' | 'line' | 'square' | 'star' }) {
  if (shape === 'star') return <span className="swatch star" style={{ color }}>&#9733;</span>
  return <span className={`swatch ${shape}`} style={{ background: color }} />
}
