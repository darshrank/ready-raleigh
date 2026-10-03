/**
 * Cloudflare Worker: serves the built app (static assets) and hosts one
 * Durable Object per room code. Clients connect to /room/<CODE> over a
 * WebSocket; the object runs the shared room state machine and broadcasts
 * state to everyone in the room.
 */
import { DurableObject } from 'cloudflare:workers'
import { disconnect, handle, newRoom, publicState, tick, type Effect, type RoomInternal } from '../src/shared/roomLogic'
import type { ClientMsg, ServerMsg } from '../src/shared/types'

interface Env {
  ROOMS: DurableObjectNamespace<Room>
  ASSETS: Fetcher
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const m = url.pathname.match(/^\/room\/([A-Za-z0-9]{3,8})$/)
    if (m) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 })
      const code = m[1].toUpperCase()
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(new Request(`https://room/${code}`, req))
    }
    return env.ASSETS.fetch(req)
  },
}

interface Attachment {
  playerId: string | null
}

export class Room extends DurableObject<Env> {
  private room: RoomInternal | null = null

  private async load(code: string) {
    if (!this.room) {
      this.room = (await this.ctx.storage.get<RoomInternal>('room')) ?? newRoom(code)
      // sockets that survived hibernation
      const live = new Set(this.ctx.getWebSockets().map((ws) => (ws.deserializeAttachment() as Attachment)?.playerId))
      for (const p of this.room.state.players) p.connected = live.has(p.id)
    }
    return this.room
  }

  async fetch(req: Request): Promise<Response> {
    const code = new URL(req.url).pathname.slice(1)
    await this.load(code)
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    pair[1].serializeAttachment({ playerId: null } satisfies Attachment)
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const room = await this.load('')
    let msg: ClientMsg
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw))
    } catch {
      return
    }
    const att = (ws.deserializeAttachment() as Attachment) ?? { playerId: null }
    if (msg.t === 'join') {
      att.playerId = String(msg.playerId).slice(0, 64)
      ws.serializeAttachment(att)
    }
    if (!att.playerId) return
    const fx = handle(room, att.playerId, msg, Date.now())
    if (fx.error) ws.send(JSON.stringify({ t: 'error', message: fx.error } satisfies ServerMsg))
    await this.commit(fx)
  }

  async webSocketClose(ws: WebSocket) {
    await this.dropSocket(ws)
  }

  async webSocketError(ws: WebSocket) {
    await this.dropSocket(ws)
  }

  private async dropSocket(ws: WebSocket) {
    const room = await this.load('')
    const id = (ws.deserializeAttachment() as Attachment)?.playerId
    const stillOpen = this.ctx.getWebSockets().some((o) => o !== ws && (o.deserializeAttachment() as Attachment)?.playerId === id)
    if (id && !stillOpen) {
      disconnect(room, id)
      await this.commit({})
    }
  }

  async alarm() {
    const room = await this.load('')
    await this.commit(tick(room, Date.now()))
  }

  private async commit(fx: Effect) {
    const room = this.room!
    if (fx.alarm === null) await this.ctx.storage.deleteAlarm()
    else if (fx.alarm) await this.ctx.storage.setAlarm(fx.alarm)
    await this.ctx.storage.put('room', room)
    const msg = JSON.stringify({ t: 'state', state: publicState(room), serverNow: Date.now() } satisfies ServerMsg)
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(msg)
      } catch {
        /* closed */
      }
    }
  }
}
