import { useState } from 'react'
import { LAYER_INFO, useStore, type LayerKey } from '../store'
import { Swatch } from './Panel'

const GROUPS = ['Hazard', 'People', 'Infrastructure', 'Your plan'] as const

/** legend swatch per layer, matching the colours in MapView */
const LEGEND: Record<LayerKey, { color: string; shape?: 'dot' | 'line' | 'square'; text: string }[]> = {
  water: [{ color: 'rgb(60,140,230)', shape: 'square', text: 'Flood water (darker = deeper)' }],
  fema: [
    { color: 'rgb(255,255,255)', shape: 'line', text: 'FEMA 100-year floodplain (official)' },
    { color: 'rgb(200,160,255)', shape: 'line', text: 'FEMA 500-year floodplain' },
  ],
  floodRoads: [
    { color: 'rgb(255,60,60)', shape: 'line', text: 'Road floods early' },
    { color: 'rgb(255,190,60)', shape: 'line', text: 'Road floods late' },
    { color: 'rgb(60,160,255)', shape: 'line', text: 'Protected road' },
  ],
  atRisk: [
    { color: 'rgb(235,60,60)', shape: 'square', text: 'At risk, unprotected' },
    { color: 'rgb(60,210,120)', shape: 'square', text: 'At risk, protected' },
  ],
  population: [{ color: 'rgb(180,140,255)', shape: 'square', text: 'More residents' }],
  elderly: [{ color: 'rgb(255,170,60)', shape: 'square', text: 'Higher share 65+' }],
  poverty: [{ color: 'rgb(255,110,160)', shape: 'square', text: 'Higher share low income' }],
  nocar: [{ color: 'rgb(120,220,255)', shape: 'square', text: 'Higher share without a car' }],
  facilities: [
    { color: 'rgb(255,212,59)', text: 'School' },
    { color: 'rgb(151,117,250)', text: 'Community center' },
    { color: 'rgb(173,181,189)', text: 'Place of worship' },
    { color: 'rgb(255,107,107)', text: 'Hospital' },
  ],
  coverage: [{ color: 'rgba(80,200,140,0.45)', shape: 'square', text: 'Within reach of a shelter' }],
}

export default function LayersPanel() {
  const layers = useStore((s) => s.layers)
  const toggle = useStore((s) => s.toggleLayer)
  const [open, setOpen] = useState(() => window.innerWidth >= 720)
  const keys = Object.keys(LAYER_INFO) as LayerKey[]
  const active = keys.filter((k) => layers[k])

  return (
    <section className={`panel layers ${open ? 'open' : ''}`}>
      <button className="layers-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>Map layers</span>
        <span className="muted">{active.length} on</span>
        <span className="chev">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="layers-body">
          {GROUPS.map((g) => (
            <div key={g} className="layer-group">
              <div className="group-title">{g}</div>
              {keys
                .filter((k) => LAYER_INFO[k].group === g)
                .map((k) => (
                  <label key={k} className="check">
                    <input type="checkbox" checked={layers[k]} onChange={() => toggle(k)} />
                    <span>{LAYER_INFO[k].label}</span>
                  </label>
                ))}
            </div>
          ))}
          {active.length > 0 && (
            <div className="legend">
              {active.flatMap((k) =>
                LEGEND[k].map((l) => (
                  <div key={k + l.text} className="legend-item">
                    <Swatch color={l.color} shape={l.shape} />
                    {l.text}
                  </div>
                )),
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
