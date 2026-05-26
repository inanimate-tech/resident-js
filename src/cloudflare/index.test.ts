import { describe, expect, it, vi } from "vitest"

// The `agents` SDK uses `cloudflare:` URL specifiers (Workers runtime). Node's
// default ESM loader can't resolve those, so we mock the SDK here. Anything
// that needs the real Agent/DO behaviour belongs in a Workers-pool test.
vi.mock("agents", () => ({
  Agent: class {},
  getAgentByName: vi.fn(),
}))

import { DeviceAgent, routeDeviceRequest } from "./index"

describe("exports", () => {
  it("exports DeviceAgent as a class", () => {
    expect(DeviceAgent).toBeTypeOf("function")
    expect(DeviceAgent.name).toBe("DeviceAgent")
  })

  it("exports routeDeviceRequest as a function", () => {
    expect(routeDeviceRequest).toBeTypeOf("function")
  })
})

describe("routeDeviceRequest", () => {
  // Not actually called for these negative-path tests — cast keeps TS happy.
  const fakeNamespace = {
    idFromName: vi.fn(),
    get: vi.fn(),
  } as unknown as DurableObjectNamespace<DeviceAgent>

  it("returns null for non-/devices paths so the caller can chain", async () => {
    const res = await routeDeviceRequest(
      new Request("https://example.com/anything"),
      fakeNamespace,
    )
    expect(res).toBeNull()
  })

  it("returns null for the root path", async () => {
    const res = await routeDeviceRequest(
      new Request("https://example.com/"),
      fakeNamespace,
    )
    expect(res).toBeNull()
  })

  it("returns null when 'devices' appears mid-path", async () => {
    const res = await routeDeviceRequest(
      new Request("https://example.com/api/devices/x"),
      fakeNamespace,
    )
    expect(res).toBeNull()
  })

  it("returns 400 when /devices/ has no id", async () => {
    const res = await routeDeviceRequest(
      new Request("https://example.com/devices/"),
      fakeNamespace,
    )
    expect(res).not.toBeNull()
    expect(res!.status).toBe(400)
  })
})
