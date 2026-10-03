import { HeatmapLayer } from '@deck.gl/aggregation-layers'
import type { Layer, PickingInfo } from '@deck.gl/core'
import { H3HexagonLayer, TripsLayer } from '@deck.gl/geo-layers'
import { BitmapLayer, GeoJsonLayer, IconLayer, PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import DeckGL from '@deck.gl/react'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Map as MapGL } from 'react-map-gl/maplibre'
import { CONFIG } from '../config'
import { levelAt } from '../engine/simulation'
import { edgeCoords, type HandRaster, type World } from '../engine/world'
import type { Placement } from '../shared/types'
import { useStore } from '../store'
import { ICON_ATLAS, ICON_MAPPING } from './icons'
import { waterImage } from './water'

const BASEMAP = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

const ATTRIBUTION = { compact: true }

type RGBA = [number, number, number, number]
const lerp = (a: number[], b: number[], t: number): RGBA =>
  [0, 1, 2, 3].map((i) => Math.round(a[i] + (b[i] - a[i]) * Math.max(0, Math.min(1, t)))) as RGBA

const MODE_COLOR: Record<string, RGBA> = { car: [255, 214, 102, 255], walk: [120, 230, 255, 255], bus: [80, 240, 150, 255] }

/** Half-resolution HAND raster (min of each 2x2 block) for fast per-frame water painting. */
function downsample(h: HandRaster): HandRaster {
  const w = h.width >> 1
  const ht = h.height >> 1
  const code = new Uint8Array(w * ht)
  const water = new Uint8Array(w * ht)
  for (let y = 0; y < ht; y++) {
    for (let x = 0; x < w; x++) {
      const i = 2 * y * h.width + 2 * x
      code[y * w + x] = Math.min(h.code[i], h.code[i + 1], h.code[i + h.width], h.code[i + h.width + 1])
      water[y * w + x] = h.water[i] | h.water[i + 1] | h.water[i + h.width] | h.water[i + h.width + 1]
    }
  }
  return { ...h, width: w, height: ht, code, water }
}

function useWorldStatics(world: World | null) {
  return useMemo(() => {
    if (!world) return null
    const { hex, graph } = world
    const popHexes: number[] = []
    let maxDensity = 0
    for (let h = 0; h < hex.n; h++) {
      if (hex.pop[h] > 0.5) {
        popHexes.push(h)
        maxDensity = Math.max(maxDensity, hex.pop[h])
      }
    }
    // flood-prone road edges, for the planning map
    const floodEdges: { e: number; path: [number, number][]; closeLevel: number; grp: number }[] = []
    const peak = CONFIG.flood.stages[CONFIG.flood.stages.length - 1]
    for (let e = 0; e < graph.nEdges; e++) {
      const cl = graph.hand[e] + CONFIG.flood.roadClosureDepth
      if (cl <= peak) floodEdges.push({ e, path: edgeCoords(graph, e), closeLevel: cl, grp: graph.grp[e] })
    }
    const edgeIds = [...Array(graph.nEdges).keys()]
    return { popHexes, maxDensity, floodEdges, edgeIds, halfHand: world.hand ? downsample(world.hand) : null }
  }, [world])
}

export default function MapView() {
  const s = useStore()
  const { world, model, layers, evaluation, room, sim, simTime, stage, placements, tool, moving, selectedId, optimal, optimalEval, resultsView } = s
  const statics = useWorldStatics(world)
  const [styleFailed, setStyleFailed] = useState(false)
  const waterCache = useRef(new Map<string, ImageData>())
  const [viewState, setViewState] = useState({ longitude: -78.645, latitude: 35.8, zoom: 11.2, pitch: 0, bearing: 0 })

  // fly to biggest miss etc. on request
  const flyTo = useStore((x) => x.flyTo)
  useEffect(() => {
    if (flyTo) setViewState((v) => ({ ...v, longitude: flyTo[0], latitude: flyTo[1], zoom: flyTo[2], transitionDuration: 1200 } as any))
  }, [flyTo])

  const phase = room?.phase ?? 'lobby'
  const inSim = phase === 'debrief' && stage === 'simulation' && !!sim
  const inResults = phase === 'debrief' && stage === 'results'
  const inReveal = phase === 'reveal'
  const reveal = useStore((x) => x.revealData)

  const shownPlan: Placement[] = inResults && resultsView === 'optimal' && optimal ? optimal.placements : placements
  const shownEval = inResults && resultsView === 'optimal' && optimalEval ? optimalEval : evaluation

  const level = inSim ? levelAt(sim!, simTime) : model?.peakLevel() ?? 4

  const water = useMemo(() => {
    if (!world?.hand) return null
    const key = (inSim ? Math.round(level * 10) / 10 : level).toFixed(1) + (inSim ? 's' : 'p')
    let img = waterCache.current.get(key)
    if (!img) {
      img = inSim && statics?.halfHand
        ? waterImage(statics.halfHand, Math.round(level * 10) / 10)
        : waterImage(world.hand, level, { alpha: 0.75 })
      if (waterCache.current.size > 60) waterCache.current.clear()
      waterCache.current.set(key, img)
    }
    return img
  }, [world, level, inSim, statics])

  const covHexes = useMemo(() => (statics && shownEval ? statics.popHexes.filter((h) => shownEval.coverageHexes[h]) : []), [statics, shownEval])
  const riskHexes = useMemo(() => (statics && shownEval ? statics.popHexes.filter((h) => shownEval.hexAtRisk[h] > 0) : []), [statics, shownEval])
  const gapHexes = useMemo(() => (statics && reveal ? statics.popHexes.filter((h) => reveal.optimalCoverage[h] - reveal.crowdCoverage[h] > 0.25) : []), [statics, reveal])

  const protectedGroups = useMemo(() => new Set(shownPlan.filter((p) => p.kind === 'road').map((p) => p.road)), [shownPlan])

  const layerList = useMemo(() => {
    if (!world || !statics || !model) return []
    const { hex } = world
    const L: Layer[] = []
    const showPlanningLayers = !inSim

    if (styleFailed) {
      L.push(new PathLayer({
        id: 'base-roads', data: statics.edgeIds, getPath: (e: number) => edgeCoords(world.graph, e) as any,
        getColor: [70, 85, 105, 255], widthMinPixels: 1, getWidth: 1,
      }))
    }

    L.push(new GeoJsonLayer({
      id: 'boundary', data: world.boundary as any, stroked: true, filled: false, getLineColor: [140, 160, 190, 160],
      lineWidthMinPixels: 1.5, getDashArray: [4, 3],
    }))

    // ---------------- people
    const choropleth = (id: string, field: Float32Array, color: number[]) =>
      new H3HexagonLayer({
        id, data: statics.popHexes, getHexagon: (h: number) => hex.id[h], extruded: false, stroked: false,
        getFillColor: (h: number) => lerp([...color.slice(0, 3), 20], [...color.slice(0, 3), 210], field[h] / 0.4),
        updateTriggers: { getFillColor: [field] },
      })
    if (layers.population && showPlanningLayers) {
      L.push(new H3HexagonLayer({
        id: 'population', data: statics.popHexes, getHexagon: (h: number) => hex.id[h], stroked: false,
        getFillColor: (h: number) => lerp([60, 80, 160, 30], [180, 140, 255, 200], Math.sqrt(hex.pop[h] / statics.maxDensity)),
      }))
    }
    if (layers.elderly && showPlanningLayers) L.push(choropleth('elderly', hex.elderly, [255, 170, 60]))
    if (layers.poverty && showPlanningLayers) L.push(choropleth('poverty', hex.poverty, [255, 110, 160]))
    if (layers.nocar && showPlanningLayers) L.push(choropleth('nocar', hex.nocar, [120, 220, 255]))

    // ---------------- hazard
    if (water && world.hand && (layers.water || inSim)) {
      L.push(new BitmapLayer({ id: 'water', image: water, bounds: world.hand.bounds as any, pickable: false }))
    }

    // official FEMA floodplain, outlined so it reads over the modelled water
    if (layers.fema && world.fema && !inSim) {
      L.push(new GeoJsonLayer({
        id: 'fema', data: world.fema as any, stroked: true, filled: true, lineWidthUnits: 'pixels',
        getFillColor: (f: any) => (f.properties.kind === '100yr' ? [255, 255, 255, 28] : [200, 160, 255, 22]),
        getLineColor: (f: any) => (f.properties.kind === '100yr' ? [255, 255, 255, 220] : [200, 160, 255, 200]),
        getLineWidth: 1.5,
      }))
    }

    // shelter reach
    if (layers.coverage && shownEval && showPlanningLayers && !inReveal) {
      L.push(new H3HexagonLayer({
        id: 'coverage', data: covHexes, getHexagon: (h: number) => hex.id[h], stroked: false,
        getFillColor: [80, 200, 140, 38],
      }))
    }

    // at-risk residents coloured by protection under the shown plan
    if (layers.atRisk && shownEval && showPlanningLayers && !inReveal) {
      const at = shownEval.hexAtRisk
      const pr = shownEval.hexProtected
      L.push(new H3HexagonLayer({
        id: 'at-risk', data: riskHexes, getHexagon: (h: number) => hex.id[h], stroked: true,
        lineWidthMinPixels: 1, getLineColor: (h: number) => (pr[h] / at[h] > 0.95 ? [80, 230, 140, 255] : [255, 90, 80, 255]),
        getFillColor: (h: number) => {
          const f = pr[h] / at[h]
          const a = 70 + Math.min(150, Math.sqrt(at[h]) * 9)
          return lerp([235, 60, 60, a], [60, 210, 120, a], f)
        },
        pickable: true, updateTriggers: { getFillColor: [shownEval], getLineColor: [shownEval] },
      }))
    }

    // flood-prone roads
    if ((layers.floodRoads || tool === 'road') && !inSim) {
      L.push(new PathLayer({
        id: 'flood-roads', data: statics.floodEdges, getPath: (d: any) => d.path,
        getColor: (d: any) => (protectedGroups.has(d.grp) ? [60, 160, 255, 255] : lerp([255, 60, 60, 230], [255, 190, 60, 200], d.closeLevel / 4)),
        getWidth: (d: any) => (d.grp >= 0 ? 4 : 2), widthUnits: 'pixels', capRounded: true,
        pickable: true, autoHighlight: tool === 'road', highlightColor: [255, 255, 255, 220],
        updateTriggers: { getColor: [protectedGroups] },
      }))
    }

    // facilities
    if (layers.facilities && !inSim) {
      const fc: Record<string, RGBA> = { school: [255, 212, 59, 230], community: [151, 117, 250, 230], worship: [173, 181, 189, 200],
        hospital: [255, 107, 107, 255], fire: [255, 146, 43, 255], police: [77, 171, 247, 255] }
      L.push(new ScatterplotLayer({
        id: 'facilities', data: world.facilities, getPosition: (f: any) => [f.lon, f.lat], getFillColor: (f: any) => fc[f.kind],
        radiusMinPixels: 3, radiusMaxPixels: 7, getRadius: 30, stroked: true, getLineColor: [0, 0, 0, 160], lineWidthMinPixels: 1,
        pickable: true,
      }))
    }

    // ---------------- simulation
    if (inSim && sim) {
      L.push(new PathLayer({
        id: 'sim-roads', data: sim.roads, getPath: (d: any) => d.path, widthUnits: 'pixels',
        getWidth: (d: any) => (!d.protected && level >= d.closeLevel ? 4 : 2),
        getColor: (d: any) => (d.protected ? [60, 160, 255, 255] : level >= d.closeLevel ? [255, 40, 40, 255] : [255, 190, 60, 90]),
        updateTriggers: { getColor: [Math.round(level * 20)], getWidth: [Math.round(level * 20)] },
      }))
      L.push(new TripsLayer({
        id: 'trips', data: sim.trips, getPath: (d: any) => d.path, getTimestamps: (d: any) => d.timestamps,
        getColor: (d: any) => MODE_COLOR[d.mode], currentTime: simTime, trailLength: 0.9, widthMinPixels: 3, capRounded: true,
        jointRounded: true, fadeTrail: true,
      }))
      L.push(new ScatterplotLayer({
        id: 'stranded', data: sim.strands, getPosition: (d: any) => d.position, radiusUnits: 'pixels',
        getRadius: (d: any) => (d.time <= simTime ? 3.5 : 0), getFillColor: (d: any) => (d.nocar ? [255, 120, 200, 255] : [255, 60, 60, 255]),
        updateTriggers: { getRadius: [Math.round(simTime * 10)] },
      }))
      const loads = sim.shelters.map(() => 0)
      for (const t of sim.trips) if (t.arrive <= simTime) loads[t.shelter] += t.people
      L.push(new TextLayer({
        id: 'shelter-load', data: sim.shelters.map((sh, i) => ({ ...sh, load: loads[i] })), getPosition: (d: any) => d.position,
        getText: (d: any) => `${Math.round(d.load).toLocaleString()} / ${d.capacity.toLocaleString()}`, getSize: 13, getColor: [255, 255, 255, 255],
        getPixelOffset: [0, -30], fontWeight: 700, outlineWidth: 3, outlineColor: [0, 0, 0, 255], fontSettings: { sdf: true },
        updateTriggers: { getText: [Math.round(simTime * 4)] },
      }))
    }

    // ---------------- reveal
    if (inReveal && reveal) {
      L.push(new HeatmapLayer({ id: 'crowd', data: reveal.points, getPosition: (d: any) => d.position, getWeight: (d: any) => d.weight,
        radiusPixels: 60, intensity: 1.2, threshold: 0.04 }))
      L.push(new H3HexagonLayer({ id: 'gap', data: gapHexes, getHexagon: (h: number) => hex.id[h], stroked: true,
        getFillColor: [230, 70, 255, 120], getLineColor: [240, 140, 255, 255], lineWidthMinPixels: 1 }))
      L.push(new TextLayer({ id: 'gap-labels', data: reveal.gaps, getPosition: (d: any) => [d.lon, d.lat], getText: (d: any) => d.district,
        getSize: 13, getColor: [255, 210, 255, 255], outlineWidth: 3, outlineColor: [20, 0, 30, 255], fontSettings: { sdf: true },
        fontWeight: 700, getPixelOffset: [0, -18] }))
      if (optimal) {
        L.push(new IconLayer({ id: 'optimal', data: optimal.placements, getPosition: (p: any) => [p.lon, p.lat],
          iconAtlas: ICON_ATLAS, iconMapping: ICON_MAPPING, getIcon: () => 'optimal', getSize: 28, sizeUnits: 'pixels', pickable: true }))
      }
    }

    // ---------------- placements
    if (!inReveal) {
      const selected = selectedId
      L.push(new IconLayer({
        id: 'placements', data: shownPlan, getPosition: (p: any) => [p.lon, p.lat], iconAtlas: ICON_ATLAS, iconMapping: ICON_MAPPING, getIcon: (p: any) => p.kind,
        getSize: (p: any) => (p.id === selected ? 44 : 34), sizeUnits: 'pixels', pickable: !inSim,
        updateTriggers: { getSize: [selected] },
      }))
    }
    return L
  }, [world, statics, model, layers, water, shownEval, shownPlan, protectedGroups, tool, inSim, inReveal, sim, simTime, level, styleFailed, selectedId, reveal, optimal, covHexes, riskHexes, gapHexes])

  const onClick = (info: PickingInfo) => {
    const st = useStore.getState()
    if (!info.coordinate || !model) return
    const [lon, lat] = info.coordinate
    if (st.room?.phase !== 'planning') {
      if (!inSim) st.selectHex(model.hexAt(lon, lat))
      return
    }
    const id = info.layer?.id
    if (id === 'placements' && !st.moving) {
      st.select((info.object as Placement).id)
      return
    }
    if (st.moving) {
      st.placeAt(lon, lat)
      return
    }
    if (st.tool === 'road') {
      if (id === 'flood-roads' && (info.object as any).grp >= 0) st.toggleRoad((info.object as any).grp)
      else if (id === 'flood-roads') st.showToast('That road section is too short to protect. Pick a highlighted main road.')
      else st.showToast('Click a flood-prone road (red or orange) to protect it.')
      return
    }
    if (st.tool) {
      st.placeAt(lon, lat)
      return
    }
    st.select(null)
    st.selectHex(model.hexAt(lon, lat))
  }

  const getTooltip = (info: PickingInfo) => {
    const o: any = info.object
    if (!o || !world) return null
    const id = info.layer?.id
    if (id === 'flood-roads') {
      const name = world.graph.names[world.graph.name[o.e]] || 'Unnamed road'
      return { text: `${name}\nFloods when water is ${o.closeLevel.toFixed(1)} m above normal${o.grp >= 0 ? '' : '\n(minor street, cannot be protected)'}` }
    }
    if (id === 'facilities') return { text: `${o.name}\n${o.kind}${o.hand !== null && o.hand < 4 ? ' · in the flood zone' : ''}` }
    if (id === 'placements' || id === 'optimal') return { text: o.label ?? o.kind }
    return null
  }

  // The basemap must not re-render on every animation frame. If the basemap
  // style can't load (offline, blocked), drop MapLibre entirely: deck.gl draws
  // our own road network, and an empty MapLibre canvas still costs a composite
  // every frame.
  const basemap = useMemo(
    () => (styleFailed ? null : <MapGL mapStyle={BASEMAP} onError={() => setStyleFailed(true)} attributionControl={ATTRIBUTION} />),
    [styleFailed],
  )

  const cursor = tool || moving ? 'crosshair' : 'grab'
  return (
    <DeckGL
      viewState={viewState as any}
      onViewStateChange={(e: any) => setViewState(e.viewState)}
      controller={{ doubleClickZoom: false }}
      layers={layerList}
      style={{ background: '#0e1621' }}
      onClick={onClick}
      getTooltip={getTooltip as any}
      getCursor={({ isHovering }) => (isHovering && (tool === 'road' || !tool) ? 'pointer' : cursor)}
    >
      {basemap}
    </DeckGL>
  )
}
