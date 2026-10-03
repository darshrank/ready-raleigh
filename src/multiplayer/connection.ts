/**
 * A room connection with one interface for both kinds of play:
 *  - RemoteRoom: WebSocket to the Cloudflare Durable Object for the room code
 *  - LocalRoom: the same state machine running in the browser (solo play,
 *    and a fallback when the room server can't be reached)
 */
import { WebSocket as ReconnectingWebSocket } from 'partysocket'
import { handle, newRoom, publicState, tick, type Effect } from '../shared/roomLogic'
import type { ClientMsg, RoomState, ServerMsg } from '../shared/types'

export interface RoomConnection {
  readonly code: string
  readonly local: boolean
  send(msg: ClientMsg): void
  close(): void
}

export interface RoomCallbacks {
  onState(state: RoomState, serverOffsetMs: number): void
  onError(message: string): void
  onStatus?(status: 'connecting' | 'open' | 'closed'): void
}

export function makeCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('')
}

export class RemoteRoom implements RoomConnection {
  readonly local = false
  private ws: ReconnectingWebSocket
  constructor(readonly code: string, private join: { playerId: string; name: string }, cb: RoomCallbacks) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    this.ws = new ReconnectingWebSocket(`${proto}://${location.host}/room/${code}`, [], { maxRetries: 20 })
    cb.onStatus?.('connecting')
    this.ws.addEventListener('open', () => {
      cb.onStatus?.('open')
      this.ws.send(JSON.stringify({ t: 'join', ...this.join } satisfies ClientMsg))
    })
    this.ws.addEventListener('close', () => cb.onStatus?.('closed'))
    this.ws.addEventListener('message', (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as ServerMsg
      if (msg.t === 'state') cb.onState(msg.state, msg.serverNow - Date.now())
      else if (msg.t === 'error') cb.onError(msg.message)
    })
  }
  send(msg: ClientMsg) {
    this.ws.send(JSON.stringify(msg))
  }
  close() {
    this.ws.close()
  }
}

export class LocalRoom implements RoomConnection {
  readonly local = true
  private room
  private timer: ReturnType<typeof setTimeout> | null = null
  constructor(readonly code: string, private playerId: string, name: string, private cb: RoomCallbacks) {
    this.room = newRoom(code)
    queueMicrotask(() => this.send({ t: 'join', playerId, name }))
  }
  send(msg: ClientMsg) {
    const fx = handle(this.room, this.playerId, msg, Date.now())
    this.apply(fx)
  }
  private apply(fx: Effect) {
    if (fx.error) this.cb.onError(fx.error)
    if (fx.alarm === null && this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    } else if (fx.alarm) {
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => this.apply(tick(this.room, Date.now())), Math.max(0, fx.alarm - Date.now()))
    }
    this.cb.onState(structuredClone(publicState(this.room)), 0)
  }
  close() {
    if (this.timer) clearTimeout(this.timer)
  }
}
