import { useEffect, useState } from 'react'
import { useStore } from '../store'

/** 12,345 */
export const num = (n: number) => Math.round(n).toLocaleString()

/** $3M, $1.5M, $500K */
export function money(n: number) {
  const sign = n < 0 ? '-' : ''
  const a = Math.abs(n)
  if (a >= 1_000_000) {
    const m = a / 1_000_000
    return `${sign}$${Number.isInteger(m) ? m : m.toFixed(1)}M`
  }
  if (a >= 1_000) return `${sign}$${Math.round(a / 1_000)}K`
  return `${sign}$${Math.round(a)}`
}

/** share as a whole percentage, 0 when the denominator is empty */
export const pct = (a: number, b: number) => (b > 0 ? Math.round((100 * a) / b) : 0)

/** m:ss */
export function clock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Server-corrected "now", re-rendering every `every` ms. */
export function useNow(every = 250) {
  const offset = useStore((s) => s.serverOffset)
  const [now, setNow] = useState(() => Date.now() + offset)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offset), every)
    setNow(Date.now() + offset)
    return () => clearInterval(id)
  }, [offset, every])
  return now
}

/** ms left until the current timed phase ends (null when untimed) */
export function useTimeLeft() {
  const endsAt = useStore((s) => s.room?.phaseEndsAt ?? null)
  const now = useNow()
  return endsAt === null ? null : Math.max(0, endsAt - now)
}

/** true when the local player hosts the room (solo players always do) */
export function useIsHost() {
  return useStore((s) => !!s.room && (s.room.hostId === s.playerId || !!s.conn?.local))
}

export const useIsSolo = () => useStore((s) => !!s.conn?.local)
