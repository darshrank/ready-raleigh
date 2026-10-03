import { useEffect, useMemo, useRef } from 'react'
import { analyseReveal } from '../engine/reveal'
import type { Submission } from '../shared/types'
import { useStore } from '../store'
import { SidePanel, Swatch } from './Panel'
import { num, useIsHost, useIsSolo } from './format'

type Entry = Submission & { earlier?: boolean }

/** Room submissions, plus earlier plays on this device when playing solo. */
function useCrowd(): Entry[] {
  const room = useStore((s) => s.room)
  const history = useStore((s) => s.history)
  const solo = useIsSolo()
  return useMemo(() => {
    const subs: Entry[] = [...(room?.submissions ?? [])]
    if (solo) {
      // the current round is in both lists, with slightly different timestamps
      const isDup = (h: Submission) => subs.some((s) => s.playerId === h.playerId && Math.abs(s.submittedAt - h.submittedAt) < 5000)
      const seen = new Set<number>()
      for (const h of history) {
        if (seen.has(h.submittedAt) || isDup(h)) continue
        seen.add(h.submittedAt)
        subs.push({ ...h, earlier: true })
      }
    }
    return subs
  }, [room?.submissions, history, solo])
}

/** Computes the room-wide analysis once per reveal; clears it afterwards. Call from Hud. */
export function useRevealAnalysis() {
  const phase = useStore((s) => s.room?.phase)
  const round = useStore((s) => s.room?.round)
  const model = useStore((s) => s.model)
  const optimalEval = useStore((s) => s.optimalEval)
  const crowd = useCrowd()
  const done = useRef('')
  // room state arrives as fresh objects, so only re-run when the set of plans changes
  const sig = crowd.map((s) => s.playerId + s.submittedAt).join('|')
  useEffect(() => {
    const { revealData, setReveal } = useStore.getState()
    if (phase !== 'reveal') {
      done.current = ''
      if (revealData) setReveal(null)
      return
    }
    if (!model || !optimalEval || crowd.length === 0) return
    const key = `${round}:${sig}`
    if (done.current === key && revealData) return
    done.current = key
    setReveal(analyseReveal(model, crowd, optimalEval))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, round, model, optimalEval, sig])
}

export default function Reveal() {
  const crowd = useCrowd()
  const data = useStore((s) => s.revealData)
  const optimal = useStore((s) => s.optimal)
  const opt = useStore((s) => s.optProgress)
  const playerId = useStore((s) => s.playerId)
  const isHost = useIsHost()
  const solo = useIsSolo()
  const st = useStore.getState
  const ranked = [...crowd].sort((a, b) => b.score - a.score)

  return (
    <SidePanel
      title={solo ? 'How you compare' : 'Room results'}
      footer={
        isHost ? (
          <button className="btn primary big" onClick={() => st().again()}>
            Play again
          </button>
        ) : (
          <div className="waiting">Waiting for the host to start another round</div>
        )
      }
    >
      <h3 className="section-title">Leaderboard</h3>
      <ol className="leaderboard">
        {ranked.map((s, i) => (
          <li key={s.playerId + s.submittedAt} className={s.playerId === playerId && !s.earlier ? 'me' : ''}>
            <span className="rank num">{i + 1}</span>
            <span className="pname">
              {s.name}
              {s.earlier && <small className="muted"> · earlier play</small>}
            </span>
            <span className="num muted tiny">{num(s.protectedPeople)} safe</span>
            <span className="lb-score num">{s.score.toFixed(0)}</span>
          </li>
        ))}
        {ranked.length === 0 && <li className="muted">No plans were submitted.</li>}
      </ol>

      <div className="compare">
        <div className="stat">
          <div className="stat-n num">{data ? data.crowdScore.toFixed(0) : '–'}</div>
          <div className="stat-l">{solo ? 'your average' : 'crowd average'}</div>
        </div>
        <div className="vs">vs</div>
        <div className="stat">
          <div className="stat-n num purple">{optimal ? optimal.score.toFixed(0) : '–'}</div>
          <div className="stat-l">best plan</div>
        </div>
      </div>

      {!optimal && (
        <div className="optimizer">
          <span className="spinner sm" /> Finding the best plan… {Math.round((opt?.p ?? 0) * 100)}%
        </div>
      )}

      {data && (
        <div className="gap-section">
          <h3 className="section-title gap-title">Perception gap</h3>
          <p className="lede">
            Areas the data flags that the {solo ? 'plans' : 'crowd'} mostly ignored: the best plan protects people here, and many of them are
            older, low-income or without a car.
          </p>
          {data.gaps.length === 0 ? (
            <p className="muted">No big gaps. The {solo ? 'plans' : 'room'} covered the places the data flags.</p>
          ) : (
            <ul className="gaps">
              {data.gaps.map((g) => (
                <li key={g.hood + g.district}>
                  <div className="gap-main">
                    <strong>{g.district}</strong>
                    <small className="muted">around {g.hood}</small>
                    <div className="tiny">
                      <span className="alert num">{num(g.people)}</span> residents at risk
                    </div>
                  </div>
                  <div className="gap-cov num">
                    <div>
                      <span className="bad">{Math.round(g.crowdCoverage * 100)}%</span> <small className="muted">{solo ? 'you' : 'crowd'}</small>
                    </div>
                    <div>
                      <span className="purple">{Math.round(g.optimalCoverage * 100)}%</span> <small className="muted">best</small>
                    </div>
                  </div>
                  <button className="btn sm" onClick={() => st().fly(g.lon, g.lat, 13)} aria-label={`Show ${g.district} on map`}>
                    Show
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="legend">
        <div className="legend-item">
          <span className="swatch heat" /> Where the {solo ? 'plans' : 'room'} placed interventions
        </div>
        <div className="legend-item">
          <Swatch color="rgb(230,70,255)" shape="square" /> Perception gap
        </div>
        <div className="legend-item">
          <Swatch color="#ae3ec9" shape="star" /> Best plan
        </div>
      </div>

    </SidePanel>
  )
}
