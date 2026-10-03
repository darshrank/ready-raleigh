import { REASON_TEXT } from '../engine/flood'
import { useStore } from '../store'
import { num, pct } from './format'

export default function HexCard() {
  const h = useStore((s) => s.selectedHex)
  const world = useStore((s) => s.world)
  const model = useStore((s) => s.model)
  const ownEval = useStore((s) => s.evaluation)
  const optimalEval = useStore((s) => s.optimalEval)
  const showOptimal = useStore((s) => s.room?.phase === 'debrief' && s.stage === 'results' && s.resultsView === 'optimal')
  if (h === null || h < 0 || !world || !model) return null
  const ev = showOptimal && optimalEval ? optimalEval : ownEval
  const { hex } = world
  const fallback = world.meta.demographics === 'citywide-fallback'

  let floodPeople = 0
  let firstStage = Infinity
  for (const i of model.unitsByHex[h] ?? []) {
    const u = model.units[i]
    floodPeople += u.pop
    firstStage = Math.min(firstStage, u.stage)
  }
  const atRisk = ev?.hexAtRisk[h] ?? 0
  const prot = ev?.hexProtected[h] ?? 0
  const reason = ev?.hexReason[h]
  const status = atRisk <= 0 ? null : prot / atRisk > 0.95 ? 'good' : prot > 0 ? 'mixed' : 'bad'

  return (
    <section className="panel hex-card">
      <header className="panel-head">
        <div>
          <h2>{hex.hoods[hex.hood[h]] || 'This area'}</h2>
          <small className="muted">{hex.districts[hex.district[h]]}</small>
        </div>
        <button className="icon-btn" onClick={() => useStore.getState().selectHex(null)} aria-label="Close">
          ×
        </button>
      </header>
      <dl className="kv">
        <dt>Residents</dt>
        <dd className="num">{num(hex.pop[h])}</dd>
        <dt>Homes flood</dt>
        <dd className="num">
          {floodPeople >= 1 ? (
            <>
              <span className="alert">{num(floodPeople)}</span> residents
            </>
          ) : (
            <span className="muted">none at {model.peakLevel()} m</span>
          )}
        </dd>
        {floodPeople >= 1 && (
          <>
            <dt>First homes flood at</dt>
            <dd className="num">{model.levels[firstStage]} m above normal</dd>
          </>
        )}
      </dl>
      <div className="shares">
        <Share label="65+" v={hex.elderly[h]} />
        <Share label="Low income" v={hex.poverty[h]} />
        <Share label="No car" v={hex.nocar[h]} />
      </div>
      {fallback && <div className="muted tiny">Shares are citywide averages.</div>}
      {status && (
        <div className={`status ${status}`}>
          <strong>
            {showOptimal ? 'Best plan' : 'Your plan'}: {num(prot)} / {num(atRisk)} protected ({pct(prot, atRisk)}%)
          </strong>
          {reason && status !== 'good' && <span>Others are stranded because {REASON_TEXT[reason]}.</span>}
        </div>
      )}
    </section>
  )
}

function Share({ label, v }: { label: string; v: number }) {
  return (
    <div className="share-cell">
      <div className="num">{Math.round(v * 100)}%</div>
      <small>{label}</small>
    </div>
  )
}
