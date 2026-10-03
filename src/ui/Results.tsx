import { useMemo } from 'react'
import { buildDebrief } from '../engine/debrief'
import type { Evaluation } from '../engine/flood'
import { useStore } from '../store'
import { Bar, SidePanel } from './Panel'
import { num, pct, useIsHost, useIsSolo } from './format'

export default function Results() {
  const model = useStore((s) => s.model)!
  const evaluation = useStore((s) => s.evaluation)
  const optimal = useStore((s) => s.optimal)
  const optimalEval = useStore((s) => s.optimalEval)
  const opt = useStore((s) => s.optProgress)
  const view = useStore((s) => s.resultsView)
  const isHost = useIsHost()
  const solo = useIsSolo()
  const st = useStore.getState

  const debrief = useMemo(
    () => (evaluation ? buildDebrief(model, evaluation, optimalEval?.score) : null),
    [model, evaluation, optimalEval],
  )
  if (!evaluation || !debrief) return null
  const showOpt = view === 'optimal' && !!optimalEval
  const ev: Evaluation = showOpt ? optimalEval! : evaluation

  return (
    <SidePanel
      title="Results"
      aside={<span className="muted tiny">{showOpt ? 'Best plan' : 'Your plan'}</span>}
      footer={
      <div className="btn-row">
        <button className="btn" onClick={() => st().replaySim()}>
          Replay
        </button>
        {isHost ? (
          <button className="btn primary" onClick={() => st().reveal()}>
            {solo ? 'See how you compare' : 'Reveal room results'}
          </button>
        ) : (
          <div className="waiting">
            <span className="spinner sm" /> Waiting for the host to reveal
          </div>
        )}
      </div>
      }
    >
      <div className="seg wide" role="tablist">
        <button className={view === 'mine' ? 'on' : ''} onClick={() => st().setResultsView('mine')}>
          Your plan
        </button>
        <button className={view === 'optimal' ? 'on' : ''} onClick={() => st().setResultsView('optimal')}>
          Best plan {optimal ? `· ${optimal.score.toFixed(0)}` : ''}
        </button>
      </div>

      {view === 'optimal' && !optimalEval && (
        <div className="optimizer">
          <span className="spinner sm" /> Finding the best plan… {Math.round((opt?.p ?? 0) * 100)}%
        </div>
      )}

      <div className="score-hero">
        <div className="score-big num">{ev.score.toFixed(0)}</div>
        <div>
          <div className="stat-l">score out of 100</div>
          <div className="num">
            <span className="good">{num(ev.protected)}</span> protected of {num(ev.atRisk)} at risk
          </div>
          {!showOpt && optimal && (
            <div className="muted tiny">Best plan the algorithm found: {optimal.score.toFixed(0)}</div>
          )}
        </div>
      </div>

      <h3 className="section-title">Vulnerable residents vs everyone</h3>
      <div className="groups">
        <GroupBar label="Everyone" g={ev.groups.all} color="var(--text-dim)" />
        <GroupBar label="No car" g={ev.groups.nocar} />
        <GroupBar label="65+" g={ev.groups.elderly} />
        <GroupBar label="Low income" g={ev.groups.poverty} />
      </div>

      {!showOpt && (
        <div className="debrief">
          <h3 className="section-title">Debrief</h3>
          <p className="headline">{debrief.headline}</p>
          {debrief.biggestMiss && (
            <div className="miss">
              <p>{debrief.biggestMiss}</p>
              {debrief.missCenter && (
                <button className="btn sm" onClick={() => st().fly(debrief.missCenter![0], debrief.missCenter![1], 14)}>
                  Show on map
                </button>
              )}
            </div>
          )}
          <p>{debrief.vulnerable}</p>
          {debrief.notes.length > 0 && (
            <ul className="notes">
              {debrief.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <h3 className="section-title">By district</h3>
      <table className="table">
        <thead>
          <tr>
            <th>Area</th>
            <th className="r">At risk</th>
            <th className="r">Protected</th>
          </tr>
        </thead>
        <tbody>
          {[...ev.districts]
            .filter((d) => d.atRisk >= 1)
            .sort((a, b) => b.atRisk - a.atRisk)
            .slice(0, 8)
            .map((d) => {
              const p = pct(d.protected, d.atRisk)
              return (
                <tr key={d.name}>
                  <td>{d.name}</td>
                  <td className="r num">{num(d.atRisk)}</td>
                  <td className={`r num ${p >= 80 ? 'good' : p < 40 ? 'bad' : ''}`}>{p}%</td>
                </tr>
              )
            })}
        </tbody>
      </table>

    </SidePanel>
  )
}

function GroupBar({ label, g, color }: { label: string; g: { atRisk: number; protected: number }; color?: string }) {
  const p = pct(g.protected, g.atRisk)
  return <Bar label={label} right={`${p}% · ${num(g.protected)} / ${num(g.atRisk)}`} value={p / 100} color={color} />
}
