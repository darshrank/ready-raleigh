import { useStore } from '../store'
import { useIsSolo } from './format'

const PHASE: Record<string, string> = { lobby: 'Lobby', briefing: 'Briefing', planning: 'Planning', reveal: 'Reveal' }

export default function TopBar() {
  const room = useStore((s) => s.room)
  const stage = useStore((s) => s.stage)
  const conn = useStore((s) => s.connStatus)
  const solo = useIsSolo()
  if (!room) return null
  const phase = room.phase === 'debrief' ? (stage === 'simulation' ? 'Simulation' : 'Results') : PHASE[room.phase]

  return (
    <header className="topbar panel">
      <span className="wordmark">
        <span className="mark" aria-hidden />
        Ready Raleigh
      </span>
      <span className="tb-sep" />
      <span className="tb-room num">{solo ? 'Solo' : room.code}</span>
      <span className="tb-phase">{phase}</span>
      {conn && <span className={`dot ${conn === 'open' ? 'on' : conn === 'connecting' ? 'wait' : 'off'}`} title={`Connection: ${conn}`} />}
      <button className="btn sm ghost tb-leave" onClick={() => useStore.getState().leave()}>
        Leave
      </button>
    </header>
  )
}
