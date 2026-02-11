/**
 * Interfaces for services that can be dynamically loaded in "hosted" mode
 * (running in the same process space to save memory).
 *
 * These are defined in @naisys/common so that both the caller and implementer
 * share the same type without a compile-time dependency between them.
 */

/** Starts the Hub server. Exported by @naisys/hub */
export type StartHub = (
  startupType: "standalone" | "hosted",
  startSupervisor?: boolean,
  plugins?: "erp"[],
  startupAgentPath?: string,
) => Promise<number>;

/** Starts the Supervisor web server. Exported by @naisys-supervisor/server */
export type StartServer = (
  startupType: "standalone" | "hosted",
  plugins?: "erp"[],
) => Promise<void>;
