# @inanimate/resident

[Resident](https://github.com/inanimate-tech/resident) is a code sandbox with hardware IO and hot reload for ESP32 devices, built so AI agents can target devices. By default, the code sandbox connects to a WebSocket server which can send it apps and events.

`@inanimate/resident` will help you build your own custom server.

- Resident already includes a basic WebSocket server for development hosted at `resident.inanimate.tech`. The Claude skills packaged with Resident allow for creating apps and pushing them to devices, using the default server as a relay.
- If you want to extend the server functionality, you need to build your own. This package includes helpers to make this easy.

Right now `@inanimate/resident` includes helpers to stand up a WebSocket server for Resident at Cloudflare.

## Cloudflare Workers

```bash
npm install @inanimate/resident agents
```

The shortest possible relay — drops in as a Cloudflare Worker with one Durable Object:

```ts
// src/worker.ts
import { DeviceAgent, routeDeviceRequest } from "@inanimate/resident/cloudflare"

export { DeviceAgent }   // exposes the DO class for the binding

export default {
  async fetch(request: Request, env: Env) {
    const res = await routeDeviceRequest(request, env.DeviceAgent)
    if (res) return res
    return new Response("Not found", { status: 404 })
  },
}
```

`wrangler.jsonc`:

```jsonc
{
  "name": "my-resident-server",
  "main": "src/worker.ts",
  "compatibility_date": "2026-01-01",
  "durable_objects": {
    "bindings": [{ "class_name": "DeviceAgent", "name": "DeviceAgent" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["DeviceAgent"] }]
}
```

Deploy with `npx wrangler deploy`. A device speaking the [Courier](https://github.com/inanimate-tech/courier) protocol opens `wss://<your-worker>/devices/<id>`; anyone with the device id pushes Lua or events to it via:

```bash
curl -X POST https://<your-worker>/devices/<id>/send \
  -H 'Content-Type: application/json' \
  -d '{"type":"app","code":"function on_tick(ctx) screen.text(10,10,\"hi\"); screen.flip(); end"}'
```

Same shape that `resident.inanimate.tech` serves.

## Extending `DeviceAgent`

Subclass and override any of `onConnect`, `onMessage`, `onClose`, `onRequest`. Call `super.X(...)` first to keep the canonical behaviour, then add your own. Example — a `/register` endpoint that returns config to the device on boot:

```ts
import { DeviceAgent } from "@inanimate/resident/cloudflare"

export class MyAgent extends DeviceAgent {
  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.endsWith("/register") && request.method === "POST") {
      return Response.json({ timezone: "Europe/London" })
    }
    return super.onRequest(request)
  }
}
```

Bind the subclass instead of `DeviceAgent` in your worker and `wrangler.jsonc`.

### The `relay` flag

The base class has one config knob:

```ts
class MyAgent extends DeviceAgent {
  protected relay = false   // disables the canonical POST /send forwarding
}
```

With `relay = false`, `POST /devices/<id>/send` returns 404 — implement your own protocol via `onRequest`.

### Monitor connections

For dashboards, `DeviceAgent` accepts a second connection class: open `wss://<host>/devices/<id>?monitor=1` and you'll receive `{type:"status",deviceConnected:bool}` pings on device connect/disconnect, plus an echo of every payload forwarded via `/send`. Ignore it if you don't need it.

## What's in the box

Today: `@inanimate/resident/cloudflare`. More subpaths (`./node`, `./protocol`, ...) will land as the surface grows.

## Development

```bash
npm install
npm run build       # → dist/cloudflare/{index.js,index.d.ts}
npm run test
npm run typecheck
```

## License

MIT — see [LICENSE](./LICENSE).
