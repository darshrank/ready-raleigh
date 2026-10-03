import { useStore } from '../store'
import Briefing from './Briefing'
import HexCard from './HexCard'
import Home from './Home'
import LayersPanel from './LayersPanel'
import Lobby from './Lobby'
import PlanningPanel from './PlanningPanel'
import Results from './Results'
import Reveal, { useRevealAnalysis } from './Reveal'
import SimHud from './SimHud'
import TopBar from './TopBar'
import './styles.css'

/** Everything drawn over the map. The root ignores the pointer; panels opt back in. */
export default function Hud() {
  const status = useStore((s) => s.status)
  const loadMsg = useStore((s) => s.loadMsg)
  const error = useStore((s) => s.error)
  const room = useStore((s) => s.room)
  const stage = useStore((s) => s.stage)
  const hasSim = useStore((s) => !!s.sim)
  const toast = useStore((s) => s.toast)
  useRevealAnalysis()

  if (status !== 'ready') {
    return (
      <div className="hud">
        <div className="center-stage">
          <div className="panel modal loading">
            <h1 className="title sm">Ready Raleigh</h1>
            {status === 'error' ? (
              <p className="warn">Could not load the city data: {error}</p>
            ) : (
              <p className="waiting">
                <span className="spinner" /> {loadMsg}…
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  const phase = room?.phase
  const inSim = phase === 'debrief' && stage === 'simulation' && hasSim
  const inResults = phase === 'debrief' && !inSim
  const showLayers = phase === 'planning' || inResults
  const modal = !room || phase === 'lobby' || phase === 'briefing'

  return (
    <div className={`hud ${room ? 'has-room' : ''} ${modal ? 'modal-open' : ''}`}>
      <TopBar />
      {!room && <Home />}
      {phase === 'lobby' && <Lobby />}
      {phase === 'briefing' && <Briefing />}
      {phase === 'planning' && <PlanningPanel />}
      {inSim && <SimHud />}
      {inResults && <Results />}
      {phase === 'reveal' && <Reveal />}
      {!inSim && (
        <div className="right-dock">
          {showLayers && <LayersPanel />}
          <HexCard />
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}
