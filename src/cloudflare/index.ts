import { Agent, getAgentByName } from "agents"
import type { Connection, ConnectionContext, WSMessage } from "agents"

/**
 * The canonical Resident relay Durable Object — mirrors the protocol that
 * `resident.inanimate.tech` runs by default:
 *
 *     wss://<host>/devices/<deviceId>             ← device WebSocket
 *     POST https://<host>/devices/<deviceId>/send ← push JSON to the device
 *
 * A second connection class — `?monitor=1` — is recognised for the bundled
 * dashboard UI: it receives device-status updates and an echo of every
 * relayed message. That's an extension on top of the canonical protocol.
 *
 * To customise, subclass and override any of `onConnect`, `onClose`,
 * `onMessage`, `onRequest`. Call `super.X(...)` first to keep the canonical
 * behaviour, then add your own.
 *
 * @example
 *   import { DeviceAgent } from "@inanimate/resident/cloudflare"
 *
 *   export class MyAgent extends DeviceAgent {
 *     async onRequest(req: Request) {
 *       const url = new URL(req.url)
 *       if (url.pathname.endsWith("/register") && req.method === "POST") {
 *         return Response.json({ timezone: "Europe/London" })
 *       }
 *       return super.onRequest(req)
 *     }
 *   }
 */
export class DeviceAgent<TEnv extends Cloudflare.Env = Cloudflare.Env> extends Agent<TEnv> {
  /**
   * When `true` (the default), `POST /devices/<id>/send` forwards JSON to the
   * device's WebSocket. Set to `false` in a subclass to disable the canonical
   * relay endpoint and implement your own protocol via `onRequest`.
   */
  protected relay = true

  /** Tag connections so devices and monitors can be addressed separately. */
  getConnectionTags(_connection: Connection, ctx: ConnectionContext): string[] {
    const url = new URL(ctx.request.url)
    if (url.searchParams.get("monitor") === "1") return ["monitor"]
    return ["device"]
  }

  /**
   * Devices speak plain WS (Courier) and don't expect agents-SDK identity /
   * state frames. Suppress those for device connections; keep them for the
   * monitor WS so a React `useAgent`-style hook can use it.
   */
  shouldSendProtocolMessages(_connection: Connection, ctx: ConnectionContext): boolean {
    const url = new URL(ctx.request.url)
    return url.searchParams.get("monitor") === "1"
  }

  onConnect(connection: Connection, ctx: ConnectionContext): void {
    const url = new URL(ctx.request.url)
    if (url.searchParams.get("monitor") === "1") {
      const deviceConnected = Array.from(this.getConnections("device")).length > 0
      connection.send(JSON.stringify({ type: "status", deviceConnected }))
    } else {
      this.broadcastStatus()
    }
  }

  onClose(_connection: Connection): void {
    this.broadcastStatus()
  }

  async onMessage(_connection: Connection, _data: WSMessage): Promise<void> {
    // v1: device-originated messages accepted but not relayed.
  }

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const subpath = url.pathname.replace(/^\/devices\/[^/]+/, "")

    if (subpath === "/send" && request.method === "POST") {
      if (!this.relay) return new Response("Relay disabled", { status: 404 })
      return this.handleSend(request)
    }
    if ((subpath === "" || subpath === "/") && request.method === "GET") {
      const conns = Array.from(this.getConnections("device")).length
      return new Response(`deviceId: ${this.name}\nconnections: ${conns}\n`, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })
    }
    return new Response("Not found", { status: 404 })
  }

  /** Canonical `/send` handler. Override for richer behaviour. */
  protected async handleSend(request: Request): Promise<Response> {
    const ct = request.headers.get("Content-Type") || ""
    if (!ct.includes("application/json")) {
      return new Response("Content-Type must be application/json", { status: 415 })
    }
    const raw = await request.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return new Response("Invalid JSON", { status: 400 })
    }
    if (typeof parsed !== "object" || parsed === null) {
      return new Response("Invalid JSON", { status: 400 })
    }

    const devices = Array.from(this.getConnections("device"))
    if (devices.length === 0) {
      return new Response("Device not connected", { status: 503 })
    }
    for (const conn of devices) conn.send(raw)
    for (const conn of this.getConnections("monitor")) conn.send(raw)
    return new Response("OK", { status: 200 })
  }

  /** Broadcast current device-connected status to all monitor connections. */
  protected broadcastStatus(): void {
    const deviceConnected = Array.from(this.getConnections("device")).length > 0
    const message = JSON.stringify({ type: "status", deviceConnected })
    for (const conn of this.getConnections("monitor")) conn.send(message)
  }
}

/**
 * Route a Resident-protocol request to its handler:
 *
 *   - `/devices/<id>/*` → the matching `DeviceAgent` instance.
 *   - `GET | HEAD /` → 200 `Resident relay`, so [Courier](https://github.com/inanimate-tech/courier)'s
 *     HTTP-`Date` time-sync fallback has something to read before NTP catches
 *     up. (Without a 200 here, devices fail to bootstrap their wall clock.)
 *
 * Returns the response, or `null` if nothing canonical matches — the caller
 * can then chain its own routing or fall through to a 404.
 *
 * @example
 *   import { routeDeviceRequest } from "@inanimate/resident/cloudflare"
 *
 *   export default {
 *     async fetch(request: Request, env: Env) {
 *       const res = await routeDeviceRequest(request, env.DeviceAgent)
 *       if (res) return res
 *       return new Response("Not found", { status: 404 })
 *     }
 *   }
 */
export async function routeDeviceRequest<T extends DeviceAgent>(
  request: Request,
  namespace: DurableObjectNamespace<T>,
): Promise<Response | null> {
  const url = new URL(request.url)
  if (
    url.pathname === "/" &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    return new Response("Resident relay\n", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  }
  if (!url.pathname.startsWith("/devices/")) return null
  const deviceId = url.pathname.split("/")[2]
  if (!deviceId) return new Response("Device ID required", { status: 400 })
  const agent = await getAgentByName(namespace, deviceId)
  return agent.fetch(request)
}
