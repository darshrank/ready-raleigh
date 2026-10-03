/** Types shared by the browser and the room server (worker/). */

export type Mode = 'flood' | 'heat'
export type PlacementKind = 'shelter' | 'bus' | 'road'

export interface Placement {
  id: string
  kind: PlacementKind
  lon: number
  lat: number
  /** road graph node the placement snaps to (shelter, bus) */
  node?: number
  /** flood-prone road stretch id (road) */
  road?: number
  /** e.g. the school or church hosting the shelter */
  label?: string
}

export interface Submission {
  playerId: string
  name: string
  placements: Placement[]
  score: number
  protectedPeople: number
  atRiskPeople: number
  spent: number
  submittedAt: number
}

export type Phase = 'lobby' | 'briefing' | 'planning' | 'debrief' | 'reveal'

export interface PlayerInfo {
  id: string
  name: string
  connected: boolean
  submitted: boolean
  score?: number
}

export interface RoomState {
  code: string
  phase: Phase
  mode: Mode
  round: number
  hostId: string | null
  players: PlayerInfo[]
  /** epoch ms when the current timed phase ends */
  phaseEndsAt: number | null
  /** only populated in the reveal phase */
  submissions: Submission[]
}

export type ClientMsg =
  | { t: 'join'; playerId: string; name: string }
  | { t: 'start'; mode: Mode }
  | { t: 'beginPlanning' }
  | { t: 'submit'; submission: Submission }
  | { t: 'reveal' }
  | { t: 'again' }

export type ServerMsg =
  | { t: 'state'; state: RoomState; serverNow: number }
  | { t: 'error'; message: string }
