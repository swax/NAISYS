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
  wizardRan?: boolean,
) => Promise<{
  serverPort: number;
  /**
   * Process-exit cleanup: stops timers and disconnects the DB so the integrated
   * hub doesn't keep the parent process alive. Does NOT close the HTTP/Socket.IO
   * server — the caller must `process.exit()` after awaiting this.
   */
  shutdown: () => Promise<void>;
}>;

/** Starts the Supervisor web server. Exported by @naisys/supervisor */
export type StartServer = (
  startupType: "standalone" | "hosted",
  plugins?: "erp"[],
  hubPort?: number,
  wizardRan?: boolean,
) => Promise<number>;

/** DB init + superadmin setup + registration-link prompt. Exported by @naisys/supervisor; must run before registering supervisorPlugin. */
export type BootstrapSupervisor = (opts: {
  resetSuperAdminAccount?: boolean;
}) => Promise<void>;

/** Dynamic import surface exported by @naisys/supervisor for hosted hub mode. */
export type HostedSupervisorModule = {
  supervisorPlugin: any;
  bootstrapSupervisor: BootstrapSupervisor;
  /** Synchronous cleanup for hosted supervisor clients/timers; callers should not await web server shutdown. */
  cleanupSupervisor?: () => void;
};
