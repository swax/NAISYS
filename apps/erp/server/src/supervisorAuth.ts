/**
 * Module-level flag indicating whether ERP should use the supervisor/hub
 * databases for SSO authentication and agent API key lookups.
 *
 * Enabled by:
 *  - SUPERVISOR_AUTH=true environment variable
 *  - Supervisor calling `enableSupervisorAuth()` before registering the ERP plugin
 */
let _enabled = false;

export function enableSupervisorAuth(): void {
  _enabled = true;
}

export function isSupervisorAuth(): boolean {
  return _enabled || process.env.SUPERVISOR_AUTH === "true";
}
