import { useState } from 'react'
import { useStore } from '../store'

export default function Home() {
  const name = useStore((s) => s.name)
  const setName = useStore((s) => s.setName)
  const world = useStore((s) => s.world)
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '')
  const ok = name.trim().length > 0
  const st = useStore.getState

  return (
    <div className="center-stage">
      <div className="panel modal home">
        <div className="eyebrow">Raleigh, NC · Emergency planning game</div>
        <h1 className="title">Ready Raleigh</h1>
        <p className="pitch">Plan Raleigh's response to a flood on real data.</p>

        <label className="field">
          <span>Your name</span>
          <input
            value={name}
            maxLength={24}
            placeholder="e.g. Sam"
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ok && st().playSolo()}
          />
        </label>

        <div className="modes">
          <div className="mode-card active">
            <div className="mode-icon flood" aria-hidden>
              ≋
            </div>
            <div>
              <strong>Flood</strong>
              <small>Creeks rise in stages, roads close, residents evacuate.</small>
            </div>
          </div>
          <div className="mode-card disabled" aria-disabled>
            <div className="mode-icon heat" aria-hidden>
              ☀
            </div>
            <div>
              <strong>Heatwave</strong>
              <small>Coming soon</small>
            </div>
          </div>
        </div>

        <div className="btn-col">
          <button className="btn primary big" disabled={!ok} onClick={() => st().playSolo()}>
            Play solo
          </button>
          <button className="btn big" disabled={!ok} onClick={() => st().createRoom()}>
            Create room
          </button>
          <form
            className="join-row"
            onSubmit={(e) => {
              e.preventDefault()
              if (ok && code.trim()) st().joinRoom(code)
            }}
          >
            <input
              className="code-input"
              value={code}
              maxLength={6}
              placeholder="CODE"
              aria-label="Room code"
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
            <button className="btn" type="submit" disabled={!ok || !code.trim()}>
              Join
            </button>
          </form>
          {!ok && <div className="hint">Enter your name to play.</div>}
        </div>

        {world && (
          <footer className="footnote">
            <strong>Data</strong>
            <ul>
              {world.meta.sources.map((s) => (
                <li key={s.name}>
                  {s.name}: <span className="muted">{s.use}</span>
                </li>
              ))}
            </ul>
            {world.meta.demographics === 'citywide-fallback' && (
              <p className="muted note">Vulnerability layers use citywide census averages until tract data is loaded.</p>
            )}
          </footer>
        )}
      </div>
    </div>
  )
}
