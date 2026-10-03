import { CONFIG } from '../config'
import { useStore } from '../store'
import { clock, money, num, useIsHost, useTimeLeft } from './format'

export default function Briefing() {
  const model = useStore((s) => s.model)!
  const isHost = useIsHost()
  const left = useTimeLeft()
  const I = CONFIG.interventions

  return (
    <div className="center-stage">
      <div className="panel modal briefing">
        <div className="alert-strip">
          <span className="pulse" /> Flood warning · Raleigh scenario
          {left !== null && <span className="countdown num">{clock(left)}</span>}
        </div>
        <h1 className="title sm">A stalled tropical storm is over Raleigh</h1>
        <p className="lede">
          Days of rain have nowhere to go. Crabtree Creek, Walnut Creek and the Neuse River will rise up to{' '}
          <strong>{model.peakLevel()} m above normal</strong> over {model.levels.length} stages. You have {money(CONFIG.budget)} and{' '}
          {Math.round(CONFIG.timers.planningSeconds / 60)} minutes to get people out.
        </p>

        <div className="stat-row">
          <div className="stat">
            <div className="stat-n alert num">{num(model.totalAtRisk())}</div>
            <div className="stat-l">residents whose homes flood</div>
          </div>
          <div className="stat">
            <div className="stat-n num">{money(CONFIG.budget)}</div>
            <div className="stat-l">budget</div>
          </div>
          <div className="stat">
            <div className="stat-n num">{model.peakLevel()} m</div>
            <div className="stat-l">peak water</div>
          </div>
        </div>

        <h3 className="section-title">Your tools</h3>
        <ul className="tool-list">
          {(Object.keys(I) as (keyof typeof I)[]).map((k) => (
            <li key={k}>
              <span className={`kind-chip ${k}`}>{money(I[k].cost)}</span>
              <div>
                <strong>{I[k].label}</strong>
                <small>{I[k].blurb}</small>
              </div>
            </li>
          ))}
        </ul>

        <h3 className="section-title">How it plays out</h3>
        <ul className="rules">
          <li>Water rises in stages. Low-lying areas evacuate first.</li>
          <li>Roads close as the water reaches them, so later evacuees may be cut off.</li>
          <li>Your score is the share of at-risk residents you protect, weighted toward residents 65+, low-income and car-free residents.</li>
        </ul>

        {isHost ? (
          <button className="btn primary big" onClick={() => useStore.getState().beginPlanning()}>
            Start planning now
          </button>
        ) : (
          <div className="waiting">
            <span className="spinner sm" /> Planning starts when the countdown ends
          </div>
        )}
      </div>
    </div>
  )
}
