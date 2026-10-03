import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/config'
import { disconnect, handle, newRoom, publicState, tick } from '../src/shared/roomLogic'
import type { Submission } from '../src/shared/types'

const sub = (score: number): Submission => ({ playerId: '', name: '', placements: [], score, protectedPeople: 0, atRiskPeople: 0, spent: 0, submittedAt: 0 })

describe('room state machine', () => {
  it('runs a full round', () => {
    const r = newRoom('ABCD')
    handle(r, 'a', { t: 'join', playerId: 'a', name: 'Ana' }, 0)
    handle(r, 'b', { t: 'join', playerId: 'b', name: 'Ben' }, 0)
    expect(r.state.hostId).toBe('a')
    expect(handle(r, 'b', { t: 'start', mode: 'flood' }, 0).error).toBeTruthy()
    const fx = handle(r, 'a', { t: 'start', mode: 'flood' }, 1000)
    expect(r.state.phase).toBe('briefing')
    expect(fx.alarm).toBe(1000 + CONFIG.timers.briefingSeconds * 1000)
    tick(r, fx.alarm!)
    expect(r.state.phase).toBe('planning')
    handle(r, 'a', { t: 'submit', submission: sub(40) }, 5000)
    expect(publicState(r).submissions).toHaveLength(0) // hidden until reveal
    expect(publicState(r).players.find((p) => p.id === 'a')!.submitted).toBe(true)
    handle(r, 'b', { t: 'submit', submission: sub(70) }, 6000)
    expect(r.state.phase).toBe('debrief') // everyone submitted: planning ends early
    handle(r, 'a', { t: 'reveal' }, 7000)
    const pub = publicState(r)
    expect(pub.phase).toBe('reveal')
    expect(pub.submissions.map((s) => s.name)).toEqual(['Ben', 'Ana'])
    handle(r, 'a', { t: 'again' }, 8000)
    expect(r.state.phase).toBe('lobby')
    expect(r.state.round).toBe(2)
  })

  it('planning ends on the timer and host passes on', () => {
    const r = newRoom('X')
    handle(r, 'a', { t: 'join', playerId: 'a', name: 'A' }, 0)
    handle(r, 'b', { t: 'join', playerId: 'b', name: 'B' }, 0)
    handle(r, 'a', { t: 'start', mode: 'flood' }, 0)
    handle(r, 'a', { t: 'beginPlanning' }, 10)
    expect(tick(r, 20).alarm).toBe(r.state.phaseEndsAt) // too early: re-arm
    tick(r, r.state.phaseEndsAt!)
    expect(r.state.phase).toBe('debrief')
    disconnect(r, 'a')
    expect(r.state.hostId).toBe('b')
  })
})
