import { describe, expect, test } from "vitest";

import { resolveConnectionStatus } from "../hooks/useConnectionStatus";

describe("resolveConnectionStatus", () => {
  test("prompts unauthenticated users to sign in", () => {
    expect(
      resolveConnectionStatus({
        isAuthenticated: false,
        serverReachable: false,
        hubConnected: null,
        transport: null,
      }),
    ).toEqual({
      status: "disconnected",
      label: "Sign in for live updates",
    });
  });

  test("reports server unreachable for authenticated users without socket reachability", () => {
    expect(
      resolveConnectionStatus({
        isAuthenticated: true,
        serverReachable: false,
        hubConnected: true,
        transport: "websocket",
      }),
    ).toEqual({
      status: "disconnected",
      label: "Server unreachable",
    });
  });

  test("prioritizes hub disconnects over polling fallback", () => {
    expect(
      resolveConnectionStatus({
        isAuthenticated: true,
        serverReachable: true,
        hubConnected: false,
        transport: "polling",
      }),
    ).toEqual({
      status: "hub-disconnected",
      label: "Hub disconnected - agent commands unavailable",
    });
  });

  test("reports polling fallback when the hub is reachable", () => {
    expect(
      resolveConnectionStatus({
        isAuthenticated: true,
        serverReachable: true,
        hubConnected: true,
        transport: "polling",
      }),
    ).toEqual({
      status: "polling",
      label: "Using polling fallback - updates may lag",
    });
  });

  test("reports websocket connections as connected", () => {
    expect(
      resolveConnectionStatus({
        isAuthenticated: true,
        serverReachable: true,
        hubConnected: true,
        transport: "websocket",
      }),
    ).toEqual({
      status: "connected",
      label: "Connected",
    });
  });

  test("keeps the initial reachable state connected while waiting for hub status", () => {
    expect(
      resolveConnectionStatus({
        isAuthenticated: true,
        serverReachable: true,
        hubConnected: null,
        transport: null,
      }),
    ).toEqual({
      status: "connected",
      label: "Connecting...",
    });
  });
});
