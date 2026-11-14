import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** A button with an anchored panel. Closes on outside click, Escape, or `close()`. */
export function Popover({
  label,
  button,
  buttonClassName = 'icon-btn',
  align = 'end',
  panelClassName = '',
  portal = false,
  children,
}: {
  label: string
  button: ReactNode
  buttonClassName?: string
  align?: 'start' | 'end'
  panelClassName?: string
  /** Render the panel on the page body, for triggers inside a container that clips overflow. */
  portal?: boolean
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [fixed, setFixed] = useState<CSSProperties>()
  const id = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node) && !panel.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    // a body-level panel does not follow the page, so it closes when the page scrolls
    const onScroll = () => setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    if (portal) window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, portal])

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={id}
        className={buttonClassName}
        onClick={() => {
          if (portal && !open && trigger.current) {
            const r = trigger.current.getBoundingClientRect()
            // end-aligned unless that would push a ~260px panel off the left edge
            const end = align === 'end' && r.right > 268
            setFixed({ position: 'fixed', top: r.bottom + 8, ...(end ? { right: Math.max(8, innerWidth - r.right) } : { left: Math.max(8, Math.min(r.left, innerWidth - 268)) }) })
          }
          setOpen((v) => !v)
        }}
      >
        {button}
      </button>
      {open &&
        (() => {
          const body = (
            <div
              ref={panel}
              id={id}
              style={portal ? fixed : undefined}
              className={`popover fade-in z-40 ${portal ? '' : `absolute top-[calc(100%+8px)] ${align === 'end' ? 'right-0' : 'left-0'}`} ${panelClassName}`}
            >
              {children(() => setOpen(false))}
            </div>
          )
          return portal ? createPortal(body, document.body) : body
        })()}
    </div>
  )
}
