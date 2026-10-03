import { CONFIG } from '../config'
import type { PlacementKind } from '../shared/types'
import { useStore } from '../store'
import { Bar, SidePanel } from './Panel'
import { clock, money, num, pct, useTimeLeft } from './format'

const KINDS: PlacementKind[] = ['shelter', 'bus', 'road']

const HINT: Record<PlacementKind, string> = {
  shelter: 'Click the map. Shelters snap to a nearby school, church or community center.',
  bus: 'Click near car-free households at risk.',
  road: 'Click a red/orange road to keep it open.',
}

export default function PlanningPanel() {
  const left = useTimeLeft()
  const ev = useStore((s) => s.evaluation)
  const tool = useStore((s) => s.tool)
  const moving = useStore((s) => s.moving)
  const placements = useStore((s) => s.placements)
  const submitted = useStore((s) => s.submittedRound !== null && s.submittedRound === s.room?.round)
  const opt = useStore((s) => s.optProgress)
  const st = useStore.getState

  const spent = ev?.spent ?? 0
  const remaining = CONFIG.budget - spent
  const urgent = left !== null && left < 30_000

  return (
    <SidePanel
      title="Plan your response"
      aside={left !== null && <span className={`timer num ${urgent ? 'urgent' : ''}`}>{clock(left)}</span>}
      footer={
        <>
          <div className="btn-row">
            {submitted ? (
              <div className="waiting">
                <span className="spinner sm" /> Submitted, waiting for others…
              </div>
            ) : (
              <>
                <button className="btn primary" onClick={() => st().submitNow()}>
                  Submit plan
                </button>
                <button className="btn ghost" onClick={() => st().clearPlan()} disabled={placements.length === 0}>
                  Clear
                </button>
              </>
            )}
          </div>

          {opt && (
            <div className="optimizer">
              <span className="spinner sm" /> The algorithm is planning too… {Math.round(opt.p * 100)}%
              <div className="bar thin">
                <div className="bar-fill" style={{ width: `${opt.p * 100}%`, background: 'var(--purple)' }} />
              </div>
            </div>
          )}
        </>
      }
    >
      <div className="budget">
        <div className="bar-label">
          <span>Budget</span>
          <span className="num">
            <strong>{money(remaining)}</strong> left of {money(CONFIG.budget)}
          </span>
        </div>
        <div className="bar budget-bar">
          <div className="bar-fill" style={{ width: `${Math.min(100, (100 * spent) / CONFIG.budget)}%` }} />
        </div>
      </div>

      <div className="tools">
        {KINDS.map((k) => {
          const I = CONFIG.interventions[k]
          const count = placements.filter((p) => p.kind === k).length
          const unaffordable = I.cost > remaining
          return (
            <button
              key={k}
              className={`tool-card ${k} ${tool === k && !moving ? 'active' : ''}`}
              disabled={submitted || (unaffordable && tool !== k)}
              onClick={() => st().setTool(tool === k ? null : k)}
              aria-pressed={tool === k}
              title={unaffordable ? 'Not enough budget left' : I.blurb}
            >
              <div className="tool-top">
                <span className={`kind-dot ${k}`} />
                <strong>{I.label}</strong>
                <span className="tool-cost num">{money(I.cost)}</span>
              </div>
              <small>{I.blurb}</small>
              <div className="tool-count">{count > 0 ? `${count} placed` : unaffordable ? 'Over budget' : 'None placed'}</div>
            </button>
          )
        })}
      </div>

      {!submitted && (moving || tool) && <div className="tool-hint">{moving ? 'Click the new location.' : HINT[tool!]}</div>}

      <SelectedPlacement />

      {ev && (
        <div className="live">
          <div className="live-row">
            <div>
              <div className="stat-l">Residents protected</div>
              <div className="stat-n num">
                <span className="good">{num(ev.protected)}</span>
                <span className="muted"> / {num(ev.atRisk)}</span>
              </div>
            </div>
            <div className="score-chip">
              <div className="stat-l">Score</div>
              <div className="stat-n num">{ev.score.toFixed(0)}</div>
            </div>
          </div>
          <div className="groups-mini">
            <GroupMini label="No car" g={ev.groups.nocar} />
            <GroupMini label="65+" g={ev.groups.elderly} />
            <GroupMini label="Low income" g={ev.groups.poverty} />
          </div>
        </div>
      )}

    </SidePanel>
  )
}

function GroupMini({ label, g }: { label: string; g: { atRisk: number; protected: number } }) {
  const p = pct(g.protected, g.atRisk)
  return <Bar label={label} right={`${p}%`} value={p / 100} />
}

function SelectedPlacement() {
  const selectedId = useStore((s) => s.selectedId)
  const p = useStore((s) => s.placements.find((x) => x.id === s.selectedId))
  const ev = useStore((s) => s.evaluation)
  const model = useStore((s) => s.model)
  const moving = useStore((s) => s.moving)
  const submitted = useStore((s) => s.submittedRound !== null && s.submittedRound === s.room?.round)
  if (!selectedId || !p || !model) return null
  const st = useStore.getState
  const shelter = p.kind === 'shelter' ? ev?.shelters.find((s) => s.placement.id === p.id) : undefined
  const bus = p.kind === 'bus' ? ev?.buses.find((b) => b.placement.id === p.id) : undefined
  const floods = shelter && shelter.floodedAtStage < model.levels.length

  return (
    <div className={`selected-card ${p.kind}`}>
      <div className="sel-head">
        <span className={`kind-dot ${p.kind}`} />
        <div>
          <strong>{p.label ?? CONFIG.interventions[p.kind].label}</strong>
          <small>{CONFIG.interventions[p.kind].label}</small>
        </div>
        <button className="icon-btn" onClick={() => st().select(null)} aria-label="Deselect">
          ×
        </button>
      </div>
      {shelter && (
        <Bar
          label="Load"
          right={`${num(shelter.load)} / ${num(shelter.capacity)}`}
          value={shelter.load / Math.max(1, shelter.capacity)}
          color={shelter.load >= shelter.capacity - 1 ? 'var(--amber)' : 'var(--green)'}
        />
      )}
      {floods && (
        <div className="warn">This site floods once the water reaches {model.levels[shelter!.floodedAtStage]} m. Move it to higher ground.</div>
      )}
      {bus && <Bar label="Riders" right={`${num(bus.riders)} / ${num(bus.capacity)}`} value={bus.riders / Math.max(1, bus.capacity)} />}
      {!submitted && (
        <div className="btn-row">
          {p.kind !== 'road' && (
            <button className="btn sm" onClick={() => (moving ? st().select(p.id) : st().startMove())}>
              {moving ? 'Cancel move' : 'Move'}
            </button>
          )}
          <button className="btn sm danger" onClick={() => st().removeSelected()}>
            Remove
          </button>
        </div>
      )}
    </div>
  )
}
