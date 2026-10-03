import { useEffect } from 'react'
import { countsAt, levelAt } from '../engine/simulation'
import { useStore } from '../store'
import { Swatch } from './Panel'
import { num } from './format'

const SPEEDS = [1, 2, 4]

/** Drives the simulation clock and shows its live counters. */
export default function SimHud() {
  const sim = useStore((s) => s.sim)!
  const simTime = useStore((s) => s.simTime)
  const playing = useStore((s) => s.simPlaying)
  const speed = useStore((s) => s.simSpeed)
  const st = useStore.getState

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last: number | null = null
    const frame = (t: number) => {
      // rAF timestamps can predate the effect, so measure from the first frame
      const dt = last === null ? 0 : Math.max(0, Math.min(0.1, (t - last) / 1000))
      last = t
      const s = useStore.getState()
      if (!s.sim || !s.simPlaying) return
      const next = s.simTime + dt * s.simSpeed
      if (next >= s.sim.duration) {
        s.setSimTime(s.sim.duration)
        s.finishSim()
        return
      }
      s.setSimTime(next)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const level = levelAt(sim, simTime)
  const counts = countsAt(sim, simTime)
  const K = sim.levels.length
  let k = 0
  for (let i = 0; i < K; i++) if (simTime >= sim.stageStart[i]) k = i + 1

  return (
    <section className="panel sim-hud">
      <div className="sim-top">
        <div className="sim-level">
          <div className="stat-l">Water level</div>
          <div className="stat-n num">
            {level.toFixed(1)} m <small className="muted">above normal</small>
          </div>
          <div className="muted tiny">
            Stage {k} / {K}
          </div>
        </div>
        <div className="sim-count good">
          <div className="stat-n big num">{num(counts.protected)}</div>
          <div className="stat-l">reached a shelter</div>
        </div>
        <div className="sim-count bad">
          <div className="stat-n big num">{num(counts.stranded)}</div>
          <div className="stat-l">stranded</div>
        </div>
      </div>
      <div className="bar thin">
        <div className="bar-fill" style={{ width: `${(100 * simTime) / Math.max(0.01, sim.duration)}%`, background: 'var(--water)' }} />
      </div>
      <div className="sim-controls">
        <button className="btn sm" onClick={() => st().setSimPlaying(!playing)}>
          {playing ? '❚❚ Pause' : '▶ Play'}
        </button>
        <div className="seg">
          {SPEEDS.map((x) => (
            <button key={x} className={x === speed ? 'on' : ''} onClick={() => st().setSimSpeed(x)}>
              {x}x
            </button>
          ))}
        </div>
        <button className="btn sm ghost" onClick={() => st().finishSim()}>
          Skip to results
        </button>
      </div>
      <div className="legend inline">
        <span className="legend-item">
          <Swatch color="rgb(255,214,102)" /> By car
        </span>
        <span className="legend-item">
          <Swatch color="rgb(120,230,255)" /> On foot
        </span>
        <span className="legend-item">
          <Swatch color="rgb(80,240,150)" /> By bus
        </span>
        <span className="legend-item">
          <Swatch color="rgb(255,60,60)" /> Stranded
        </span>
        <span className="legend-item">
          <Swatch color="rgb(255,120,200)" /> Stranded, no car
        </span>
        <span className="legend-item">
          <Swatch color="rgb(255,40,40)" shape="line" /> Road closed
        </span>
        <span className="legend-item">
          <Swatch color="rgb(60,160,255)" shape="line" /> Protected road
        </span>
      </div>
    </section>
  )
}
