/**
 * Room state machine, shared by the Cloudflare Durable Object (multiplayer)
 * and the in-browser LocalRoom (solo play) so both behave identically.
 *
 *   lobby --start--> briefing --timer/host--> planning --timer--> debrief --host--> reveal --again--> lobby
 *
 * During planning each client computes its own score (the engine is
 * deterministic and runs in the browser) and submits its plan; the room
 * collects plans and reveals them all together.
 */
import { CONFIG } from '../config'
import type { ClientMsg, RoomState, Submission } from './types'

export interface RoomInternal {
  state: RoomState
  /** kept private until the reveal */
  submissions: Record<string, Submission>
}

export function newRoom(code: string): RoomInternal {
  return {
    state: { code, phase: 'lobby', mode: 'flood', round: 1, hostId: null, players: [], phaseEndsAt: null, submissions: [] },
    submissions: {},
  }
}

/** Public view: submissions only appear at the reveal; players show who has submitted. */
export function publicState(room: RoomInternal): RoomState {
  const s = room.state
  return {
    ...s,
    players: s.players.map((p) => ({ ...p, submitted: !!room.submissions[p.id], score: room.submissions[p.id]?.score })),
    submissions: s.phase === 'reveal' ? Object.values(room.submissions).sort((a, b) => b.score - a.score) : [],
  }
}

export interface Effect {
  /** schedule tick() at this epoch ms (null = cancel) */
  alarm?: number | null
  error?: string
}

/** Apply a client message. Returns side effects for the host to perform. */
export function handle(room: RoomInternal, playerId: string, msg: ClientMsg, now: number): Effect {
  const s = room.state
  const isHost = s.hostId === playerId
  switch (msg.t) {
    case 'join': {
      const name = (msg.name || 'Player').slice(0, 24)
      const p = s.players.find((x) => x.id === playerId)
      if (p) {
        p.name = name
        p.connected = true
      } else {
        s.players.push({ id: playerId, name, connected: true, submitted: false })
      }
      if (!s.hostId || !s.players.find((x) => x.id === s.hostId && x.connected)) s.hostId = playerId
      return {}
    }
    case 'start': {
      if (!isHost) return { error: 'Only the host can start' }
      if (s.phase !== 'lobby') return {}
      s.mode = msg.mode
      s.phase = 'briefing'
      s.phaseEndsAt = now + CONFIG.timers.briefingSeconds * 1000
      room.submissions = {}
      return { alarm: s.phaseEndsAt }
    }
    case 'beginPlanning': {
      if (!isHost || s.phase !== 'briefing') return {}
      return startPlanning(room, now)
    }
    case 'submit': {
      if (s.phase !== 'planning' && s.phase !== 'debrief') return { error: 'Planning is over' }
      const p = s.players.find((x) => x.id === playerId)
      if (!p) return { error: 'Join first' }
      room.submissions[playerId] = { ...msg.submission, playerId, name: p.name, submittedAt: now }
      // everyone connected has submitted: end planning early
      if (s.phase === 'planning' && s.players.filter((x) => x.connected).every((x) => room.submissions[x.id])) {
        s.phase = 'debrief'
        s.phaseEndsAt = null
        return { alarm: null }
      }
      return {}
    }
    case 'reveal': {
      if (!isHost || s.phase !== 'debrief') return {}
      s.phase = 'reveal'
      return {}
    }
    case 'again': {
      if (!isHost) return {}
      s.phase = 'lobby'
      s.round += 1
      s.phaseEndsAt = null
      room.submissions = {}
      return { alarm: null }
    }
  }
  return {}
}

function startPlanning(room: RoomInternal, now: number): Effect {
  const s = room.state
  s.phase = 'planning'
  s.phaseEndsAt = now + CONFIG.timers.planningSeconds * 1000
  return { alarm: s.phaseEndsAt }
}

/** Timer fired. */
export function tick(room: RoomInternal, now: number): Effect {
  const s = room.state
  if (!s.phaseEndsAt || now < s.phaseEndsAt - 50) return s.phaseEndsAt ? { alarm: s.phaseEndsAt } : {}
  if (s.phase === 'briefing') return startPlanning(room, now)
  if (s.phase === 'planning') {
    s.phase = 'debrief'
    s.phaseEndsAt = null
  }
  return {}
}

export function disconnect(room: RoomInternal, playerId: string) {
  const s = room.state
  const p = s.players.find((x) => x.id === playerId)
  if (p) p.connected = false
  if (s.hostId === playerId) s.hostId = s.players.find((x) => x.connected)?.id ?? null
  if (s.phase === 'lobby') s.players = s.players.filter((x) => x.connected)
}
