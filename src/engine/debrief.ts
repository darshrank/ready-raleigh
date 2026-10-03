/**
 * Plain-English debrief built from the spatial results. (Rule-based for now;
 * the Gemini bonus step can rewrite these facts into a narrated summary.)
 */
import { CONFIG } from '../config'
import { REASON_TEXT, type Evaluation, type FloodModel, type Reason } from './flood'

export interface Debrief {
  headline: string
  biggestMiss: string | null
  vulnerable: string
  notes: string[]
  /** where the biggest miss is, for the map */
  missCenter: [number, number] | null
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const pct = (a: number, b: number) => (b > 0 ? Math.round((100 * a) / b) : 0)

export function buildDebrief(model: FloodModel, ev: Evaluation, optimalScore?: number): Debrief {
  const { hex } = model.world
  const headline = `You got ${fmt(ev.protected)} of ${fmt(ev.atRisk)} residents in the flood zone to safety, for a score of ${ev.score.toFixed(0)}.`

  // ---- biggest miss: neighbourhood with the most weighted stranded residents
  const byHood = new Map<number, { people: number; weighted: number; nocar: number; reasons: Map<Reason, number>; lon: number; lat: number; n: number; district: number }>()
  for (const s of ev.strands) {
    const u = model.units[s.unit]
    const h = hex.hood[u.hex]
    const rec = byHood.get(h) ?? { people: 0, weighted: 0, nocar: 0, reasons: new Map(), lon: 0, lat: 0, n: 0, district: hex.district[u.hex] }
    rec.people += s.people
    rec.weighted += s.people * (u.w + (s.nocar ? CONFIG.scoring.weights.nocar : 0))
    if (s.nocar) rec.nocar += s.people
    rec.reasons.set(s.reason, (rec.reasons.get(s.reason) ?? 0) + s.people)
    rec.lon += hex.lon[u.hex] * s.people
    rec.lat += hex.lat[u.hex] * s.people
    rec.n += s.people
    byHood.set(h, rec)
  }
  let biggestMiss: string | null = null
  let missCenter: [number, number] | null = null
  const top = [...byHood.entries()].sort((a, b) => b[1].weighted - a[1].weighted)[0]
  if (top && top[1].people >= 1) {
    const [h, r] = top
    const reason = [...r.reasons.entries()].sort((a, b) => b[1] - a[1])[0][0]
    const households = r.nocar / 2.4
    const where = `around ${hex.hoods[h]} (${hex.districts[r.district]})`
    biggestMiss = `Biggest miss: ${fmt(r.people)} residents ${where} were stranded because ${REASON_TEXT[reason]}.` +
      (households >= 5 ? ` About ${fmt(households)} of those households have no car.` : '')
    missCenter = [r.lon / r.n, r.lat / r.n]
  }

  // ---- vulnerable groups vs everyone
  const all = pct(ev.groups.all.protected, ev.groups.all.atRisk)
  const nc = pct(ev.groups.nocar.protected, ev.groups.nocar.atRisk)
  const old = pct(ev.groups.elderly.protected, ev.groups.elderly.atRisk)
  let vulnerable = `${all}% of everyone at risk was protected, against ${nc}% of residents without a car and ${old}% of residents over 65.`
  if (nc + 10 < all) vulnerable += ' Car-free households were left behind: bus pickups near them would close the gap.'

  // ---- notes
  const notes: string[] = []
  for (const s of ev.shelters) {
    const name = s.placement.label ?? 'your shelter'
    if (s.floodedAtStage < model.levels.length) notes.push(`${name} flooded once the water rose ${model.levels[s.floodedAtStage]} m. Pick higher ground.`)
    else if (s.load >= s.capacity - 1) notes.push(`${name} filled up (${fmt(s.capacity)} people). A second shelter nearby would have taken the overflow.`)
    else if (s.load < s.capacity * 0.15) notes.push(`${name} only took ${fmt(s.load)} people. It is far from where the water rises.`)
  }
  for (const b of ev.buses) if (b.riders < 20) notes.push('A bus pickup carried almost nobody: few car-free residents at risk live within a 10-minute walk.')
  const cut = ev.strands.filter((s) => s.reason === 'roads-flooded').reduce((a, s) => a + s.people, 0)
  if (cut > 50) {
    // name the main roads that flood before the peak
    const peak = model.peakLevel()
    const names = new Map<string, number>()
    for (const r of model.world.roads) {
      if (r.hand + CONFIG.flood.roadClosureDepth < peak && r.name && r.cls !== 'unclassified') names.set(r.name, (names.get(r.name) ?? 0) + r.length)
    }
    const top3 = [...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((x) => x[0])
    notes.push(`Flooded roads cut ${fmt(cut)} residents off from a shelter. ${top3.join(', ')} go under early. Protecting the right stretch reopens a route.`)
  }
  if (optimalScore !== undefined) {
    const d = optimalScore - ev.score
    notes.push(d > 1 ? `The best plan the algorithm found scores ${optimalScore.toFixed(0)}, ${d.toFixed(0)} points more.` :
      `You matched the best plan the algorithm found (${optimalScore.toFixed(0)}).`)
  }
  return { headline, biggestMiss, vulnerable, notes, missCenter }
}
