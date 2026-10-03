import { create } from 'zustand'
import { CONFIG } from './config'
import { FloodModel, type Evaluation } from './engine/flood'
import { configHash, type OptimizeResult } from './engine/optimize'
import type { RevealAnalysis } from './engine/reveal'
import { buildSimulation, type Simulation } from './engine/simulation'
import { distanceM, loadWorld, nearestNode, type World } from './engine/world'
import { LocalRoom, makeCode, RemoteRoom, type RoomConnection } from './multiplayer/connection'
import type { Mode, Placement, PlacementKind, RoomState, Submission } from './shared/types'

export type LayerKey = 'water' | 'fema' | 'floodRoads' | 'atRisk' | 'population' | 'elderly' | 'poverty' | 'nocar' | 'facilities' | 'coverage'

export const LAYER_INFO: Record<LayerKey, { label: string; group: 'Hazard' | 'People' | 'Infrastructure' | 'Your plan' }> = {
  water: { label: 'Flood extent at peak', group: 'Hazard' },
  fema: { label: 'FEMA 100-yr floodplain', group: 'Hazard' },
  floodRoads: { label: 'Flood-prone roads', group: 'Hazard' },
  atRisk: { label: 'Residents at risk', group: 'People' },
  population: { label: 'Population density', group: 'People' },
  elderly: { label: 'Residents 65+', group: 'People' },
  poverty: { label: 'Low income', group: 'People' },
  nocar: { label: 'No car', group: 'People' },
  facilities: { label: 'Schools, churches, hospitals', group: 'Infrastructure' },
  coverage: { label: `Shelter reach (${CONFIG.interventions.shelter.driveMinutes} min drive)`, group: 'Your plan' },
}

export type ClientStage = 'simulation' | 'results'

interface Store {
  status: 'loading' | 'ready' | 'error'
  loadMsg: string
  error: string | null
  world: World | null
  model: FloodModel | null

  playerId: string
  name: string

  conn: RoomConnection | null
  room: RoomState | null
  serverOffset: number
  connStatus: 'connecting' | 'open' | 'closed' | null

  placements: Placement[]
  tool: PlacementKind | null
  selectedId: string | null
  moving: boolean
  evaluation: Evaluation | null

  optimal: OptimizeResult | null
  optimalEval: Evaluation | null
  optProgress: { p: number; msg: string } | null

  layers: Record<LayerKey, boolean>
  selectedHex: number | null
  toast: string | null

  stage: ClientStage
  sim: Simulation | null
  simTime: number
  simPlaying: boolean
  simSpeed: number
  submittedRound: number | null
  resultsView: 'mine' | 'optimal'
  history: Submission[]
  /** room-wide analysis, set when the reveal phase starts */
  revealData: RevealAnalysis | null
  /** ask the map to fly somewhere: [lon, lat, zoom] */
  flyTo: [number, number, number] | null

  init(): Promise<void>
  setName(n: string): void
  playSolo(): void
  createRoom(): void
  joinRoom(code: string): void
  leave(): void
  start(mode: Mode): void
  beginPlanning(): void
  submitNow(): void
  reveal(): void
  again(): void

  setTool(t: PlacementKind | null): void
  placeAt(lon: number, lat: number): void
  toggleRoad(group: number): void
  select(id: string | null): void
  startMove(): void
  removeSelected(): void
  clearPlan(): void
  toggleLayer(k: LayerKey): void
  selectHex(h: number | null): void
  showToast(msg: string): void

  setSimTime(t: number): void
  setSimPlaying(p: boolean): void
  setSimSpeed(s: number): void
  finishSim(): void
  replaySim(): void
  setResultsView(v: 'mine' | 'optimal'): void
  setReveal(r: RevealAnalysis | null): void
  fly(lon: number, lat: number, zoom?: number): void
}

const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* private mode */
  }
}

const playerId = lsGet('rr:id') ?? crypto.randomUUID()
lsSet('rr:id', playerId)

let uid = 0
const newId = () => `p${Date.now().toString(36)}${(uid++).toString(36)}`

/** Optimal plans are cached per config + data build, since they take ~30 s. */
const optimalKey = (w: World) => `rr:opt:${w.meta.generated}:${configHash(CONFIG)}`

let optWorker: Worker | null = null
let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useStore = create<Store>((set, get) => {
  const connect = (code: string, local: boolean) => {
    get().conn?.close()
    const { name } = get()
    const cb = {
      onState: (state: RoomState, off: number) => onRoomState(state, off),
      onError: (m: string) => get().showToast(m),
      onStatus: (s: 'connecting' | 'open' | 'closed') => set({ connStatus: s }),
    }
    const conn = local ? new LocalRoom(code, playerId, name, cb) : new RemoteRoom(code, { playerId, name }, cb)
    set({ conn, connStatus: local ? null : 'connecting' })
    if (!local) {
      history.replaceState(null, '', `?room=${code}`)
      setTimeout(() => {
        if (get().conn === conn && get().connStatus !== 'open') {
          get().showToast("Can't reach the room server. Run `npm run dev` (it starts the server), or play solo.")
        }
      }, 5000)
    }
  }

  const onRoomState = (state: RoomState, off: number) => {
    const prev = get().room
    set({ room: state, serverOffset: off })
    if (state.phase === 'planning' && (prev?.phase !== 'planning' || prev.round !== state.round)) {
      set({ placements: [], tool: 'shelter', selectedId: null, moving: false, submittedRound: null, sim: null, stage: 'simulation' })
      recompute()
      startOptimizer()
    }
    if (state.phase === 'debrief' && get().submittedRound !== state.round) submit()
    if (state.phase === 'debrief' && prev?.phase !== 'debrief') startSimulation()
    if (state.phase === 'lobby' && prev && prev.phase !== 'lobby') set({ sim: null, placements: [], evaluation: null })
  }

  const recompute = () => {
    const { model, placements } = get()
    if (!model) return
    set({ evaluation: model.evaluate(placements) })
  }

  const startOptimizer = () => {
    const { world, model, optimal } = get()
    if (!world || !model || optimal || optWorker) return
    const cached = lsGet(optimalKey(world))
    if (cached) {
      const res = JSON.parse(cached) as OptimizeResult
      set({ optimal: res, optimalEval: model.evaluate(res.placements), optProgress: null })
      return
    }
    if (world.optimal && world.optimal.configHash === configHash(CONFIG) && world.optimal.generated === world.meta.generated) {
      set({ optimal: world.optimal, optimalEval: model.evaluate(world.optimal.placements), optProgress: null })
      return
    }
    optWorker = new Worker(new URL('./engine/optimizer.worker.ts', import.meta.url), { type: 'module' })
    optWorker.onmessage = (e) => {
      const m = e.data
      if (m.t === 'progress') set({ optProgress: { p: m.p, msg: m.msg } })
      else if (m.t === 'done') {
        lsSet(optimalKey(world), JSON.stringify(m.result))
        set({ optimal: m.result, optimalEval: get().model!.evaluate(m.result.placements), optProgress: null })
        optWorker?.terminate()
        optWorker = null
      } else if (m.t === 'error') {
        console.error(m.message)
        optWorker?.terminate()
        optWorker = null
      }
    }
    optWorker.postMessage({ t: 'run' })
    set({ optProgress: { p: 0, msg: 'Starting' } })
  }

  const submit = () => {
    const { conn, room, placements, evaluation, name } = get()
    if (!conn || !room || !evaluation) return
    const submission: Submission = {
      playerId, name, placements, score: evaluation.score, protectedPeople: evaluation.protected,
      atRiskPeople: evaluation.atRisk, spent: evaluation.spent, submittedAt: Date.now(),
    }
    // mark first: a LocalRoom answers synchronously and re-enters onRoomState
    set({ submittedRound: room.round, tool: null, selectedId: null })
    conn.send({ t: 'submit', submission })
    if (conn.local) {
      // solo: remember plays on this device so the reveal has a crowd to compare with
      const history = [...get().history, submission].slice(-30)
      set({ history })
      lsSet('rr:history', JSON.stringify(history))
    }
  }

  const startSimulation = () => {
    const { model, placements, evaluation } = get()
    if (!model || !evaluation) return
    const sim = buildSimulation(model, placements, evaluation)
    set({ sim, simTime: 0, simPlaying: true, stage: 'simulation', selectedHex: null })
  }

  const spentWith = (extra: PlacementKind | null, exclude?: string) =>
    get().placements.filter((p) => p.id !== exclude).reduce((s, p) => s + CONFIG.interventions[p.kind].cost, 0) +
    (extra ? CONFIG.interventions[extra].cost : 0)

  const canEdit = () => get().room?.phase === 'planning' && get().submittedRound !== get().room?.round

  return {
    status: 'loading',
    loadMsg: 'Loading',
    error: null,
    world: null,
    model: null,
    playerId,
    name: lsGet('rr:name') ?? '',
    conn: null,
    room: null,
    serverOffset: 0,
    connStatus: null,
    placements: [],
    tool: null,
    selectedId: null,
    moving: false,
    evaluation: null,
    optimal: null,
    optimalEval: null,
    optProgress: null,
    layers: { water: true, fema: false, floodRoads: true, atRisk: true, population: false, elderly: false, poverty: false, nocar: false, facilities: false, coverage: true },
    selectedHex: null,
    toast: null,
    stage: 'simulation',
    sim: null,
    simTime: 0,
    simPlaying: false,
    simSpeed: 1,
    submittedRound: null,
    resultsView: 'mine',
    history: JSON.parse(lsGet('rr:history') ?? '[]'),
    revealData: null,
    flyTo: null,

    async init() {
      try {
        const world = await loadWorld((m) => set({ loadMsg: m }))
        set({ loadMsg: 'Modelling the flood' })
        const model = new FloodModel(world)
        set({ world, model, status: 'ready', evaluation: model.evaluate([]) })
        const code = new URLSearchParams(location.search).get('room')
        if (code && get().name) get().joinRoom(code)
      } catch (e) {
        set({ status: 'error', error: String(e) })
      }
    },
    setName(n) {
      set({ name: n })
      lsSet('rr:name', n)
    },
    playSolo() {
      connect('SOLO', true)
    },
    createRoom() {
      connect(makeCode(), false)
    },
    joinRoom(code) {
      connect(code.toUpperCase().trim(), false)
    },
    leave() {
      get().conn?.close()
      set({ conn: null, room: null, placements: [], sim: null, connStatus: null })
      history.replaceState(null, '', location.pathname)
    },
    start(mode) {
      get().conn?.send({ t: 'start', mode })
    },
    beginPlanning() {
      get().conn?.send({ t: 'beginPlanning' })
    },
    submitNow() {
      if (!canEdit()) return
      submit()
    },
    reveal() {
      get().conn?.send({ t: 'reveal' })
    },
    again() {
      get().conn?.send({ t: 'again' })
    },

    setTool(t) {
      set({ tool: t, selectedId: null, moving: false })
    },
    placeAt(lon, lat) {
      if (!canEdit()) return
      const { tool, world, moving, selectedId, placements } = get()
      if (!world) return
      const kind = moving ? placements.find((p) => p.id === selectedId)?.kind : tool
      if (!kind || kind === 'road') return
      if (!moving && spentWith(kind) > CONFIG.budget) {
        get().showToast('Over budget. Remove something first.')
        return
      }
      let label: string | undefined
      if (kind === 'shelter') {
        // snap to a real building that could host a shelter
        let best = -1
        let bd = 350
        world.facilities.forEach((f, i) => {
          if (!f.shelter) return
          const d = distanceM(lon, lat, f.lon, f.lat)
          if (d < bd) {
            bd = d
            best = i
          }
        })
        if (best >= 0) {
          const f = world.facilities[best]
          lon = f.lon
          lat = f.lat
          label = f.name
        } else label = 'Pop-up shelter'
      }
      const node = nearestNode(world.graph, lon, lat)
      if (kind === 'bus') {
        const h = get().model!.hexAt(lon, lat)
        label = `Bus pickup near ${world.hex.hoods[world.hex.hood[h]]}`
      }
      if (moving && selectedId) {
        set({ placements: placements.map((p) => (p.id === selectedId ? { ...p, lon, lat, node, label } : p)), moving: false })
      } else {
        set({ placements: [...placements, { id: newId(), kind, lon, lat, node, label }] })
      }
      recompute()
    },
    toggleRoad(group) {
      if (!canEdit()) return
      const { placements, world } = get()
      const existing = placements.find((p) => p.kind === 'road' && p.road === group)
      if (existing) {
        set({ placements: placements.filter((p) => p !== existing) })
      } else {
        if (spentWith('road') > CONFIG.budget) {
          get().showToast('Over budget. Remove something first.')
          return
        }
        const r = world!.roads[group]
        set({ placements: [...placements, { id: newId(), kind: 'road', lon: r.lon, lat: r.lat, road: group, label: r.name || 'Unnamed road' }] })
      }
      recompute()
    },
    select(id) {
      set({ selectedId: id, moving: false })
    },
    startMove() {
      if (get().selectedId) set({ moving: true })
    },
    removeSelected() {
      const { selectedId, placements } = get()
      if (!selectedId || !canEdit()) return
      set({ placements: placements.filter((p) => p.id !== selectedId), selectedId: null, moving: false })
      recompute()
    },
    clearPlan() {
      if (!canEdit()) return
      set({ placements: [], selectedId: null, moving: false })
      recompute()
    },
    toggleLayer(k) {
      set({ layers: { ...get().layers, [k]: !get().layers[k] } })
    },
    selectHex(h) {
      set({ selectedHex: h })
    },
    showToast(msg) {
      set({ toast: msg })
      if (toastTimer) clearTimeout(toastTimer)
      toastTimer = setTimeout(() => set({ toast: null }), 3200)
    },

    setSimTime(t) {
      set({ simTime: t })
    },
    setSimPlaying(p) {
      set({ simPlaying: p })
    },
    setSimSpeed(s) {
      set({ simSpeed: s })
    },
    finishSim() {
      set({ simPlaying: false, stage: 'results', resultsView: 'mine' })
    },
    replaySim() {
      set({ simTime: 0, simPlaying: true, stage: 'simulation' })
    },
    setResultsView(v) {
      set({ resultsView: v })
    },
    setReveal(r) {
      set({ revealData: r })
    },
    fly(lon, lat, zoom = 14) {
      set({ flyTo: [lon, lat, zoom] })
    },
  }
})
