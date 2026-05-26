# @inanimate/resident

JavaScript/TypeScript bits of [Resident](https://github.com/inanimate-tech/resident) — a sandboxed Lua runtime for connected devices.

This package ships several subpath imports under a single install:

| Import | Purpose |
| --- | --- |
| `@inanimate/resident/cloudflare` | Cloudflare Workers integration — `DeviceAgent` Durable Object + `routeDeviceRequest` helper. Mirrors the canonical protocol that `resident.inanimate.tech` runs. |

More subpaths (`./protocol`, `./node`, etc.) will be added as the surface grows.

## Cloudflare Workers — quick start

```bash
npm install @inanimate/resident agents
```

```ts
import { DeviceAgent, routeDeviceRequest } from "@inanimate/resident/cloudflare"

export { DeviceAgent }   // the canonical relay, ready to use as-is

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
  "durable_objects": {
    "bindings": [{ "class_name": "DeviceAgent", "name": "DeviceAgent" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["DeviceAgent"] }]
}
```

That's the whole canonical relay: a device speaking the [Courier](https://github.com/inanimate-tech/courier) protocol can open a WebSocket to `wss://<your-worker>/devices/<id>`, and anyone with the device ID can `POST` JSON to `/devices/<id>/send` to forward it.

## Extending `DeviceAgent`

`DeviceAgent` is designed to be subclassed. Override `onConnect`, `onMessage`, `onClose`, or `onRequest` — call `super.X(...)` first to keep the canonical behaviour, then add your own:

```ts
import { DeviceAgent } from "@inanimate/resident/cloudflare"
import type { Connection, ConnectionContext } from "agents"

export class MyAgent extends DeviceAgent {
  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url)
    // Add a /register endpoint that returns config to the device on boot.
    if (url.pathname.endsWith("/register") && request.method === "POST") {
      return Response.json({ timezone: "Europe/London" })
    }
    return super.onRequest(request)
  }

  async onConnect(connection: Connection, ctx: ConnectionContext): Promise<void> {
    await super.onConnect(connection, ctx)
    // ... push state to a newly-connected device, etc.
  }
}
```

### `relay` flag

The single configuration knob on the base class:

```ts
class MyAgent extends DeviceAgent {
  protected relay = false   // disables POST /send → device WS forwarding
}
```

With `relay = false`, the canonical `/send` endpoint returns 404 — implement your own protocol via `onRequest`.

## Development

```bash
npm install
npm run build       # → dist/cloudflare/{index.js,index.d.ts}
npm run typecheck
```

## License

MIT — see [LICENSE](./LICENSE).
