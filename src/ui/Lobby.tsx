import { useState } from 'react'
import { useStore } from '../store'
import { useIsHost, useIsSolo } from './format'

export default function Lobby() {
  const room = useStore((s) => s.room)!
  const playerId = useStore((s) => s.playerId)
  const isHost = useIsHost()
  const solo = useIsSolo()
  const [copied, setCopied] = useState(false)
  const link = `${location.origin}${location.pathname}?room=${room.code}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      useStore.getState().showToast('Copy failed. Select the link and copy it.')
    }
  }

  return (
    <div className="center-stage">
      <div className="panel modal lobby">
        {solo ? (
          <>
            <div className="eyebrow">Solo game</div>
            <h1 className="title sm">Ready when you are</h1>
            <p className="pitch">You will plan alone, then compare your plan with the algorithm and your earlier plays.</p>
          </>
        ) : (
          <>
            <div className="eyebrow">Room code</div>
            <div className="room-code">{room.code}</div>
            <div className="share">
              <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Share link" />
              <button className="btn" onClick={copy}>
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          </>
        )}

        {!solo && (
          <>
            <h3 className="section-title">Players ({room.players.length})</h3>
            <ul className="players">
              {room.players.map((p) => (
                <li key={p.id}>
                  <span className={`dot ${p.connected ? 'on' : 'off'}`} title={p.connected ? 'Connected' : 'Disconnected'} />
                  <span className="pname">
                    {p.name}
                    {p.id === playerId && <span className="muted"> (you)</span>}
                  </span>
                  {p.id === room.hostId && <span className="badge">Host</span>}
                </li>
              ))}
            </ul>
          </>
        )}

        {isHost ? (
          <button className="btn primary big" onClick={() => useStore.getState().start('flood')}>
            Start flood scenario
          </button>
        ) : (
          <div className="waiting">
            <span className="spinner sm" /> Waiting for host to start
          </div>
        )}
      </div>
    </div>
  )
}
