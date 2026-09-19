export type DesktopBackendName = "windows" | "macos" | "x11" | "wayland";

/** Host-local selection; an explicit backend must never fall back to another desktop. */
export function selectDesktopBackend(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): DesktopBackendName | null {
  const requested = env.NAISYS_DESKTOP_BACKEND?.trim().toLowerCase();
  if (requested && requested !== "auto") {
    switch (requested) {
      case "x11":
      case "wayland":
        if (platform !== "linux") {
          throw new Error(
            `NAISYS_DESKTOP_BACKEND=${requested} requires Linux.`,
          );
        }
        if (requested === "x11" && !env.DISPLAY) {
          throw new Error("NAISYS_DESKTOP_BACKEND=x11 requires DISPLAY.");
        }
        if (requested === "wayland" && !env.WAYLAND_DISPLAY) {
          throw new Error(
            "NAISYS_DESKTOP_BACKEND=wayland requires WAYLAND_DISPLAY.",
          );
        }
        return requested;
      case "windows":
        if (
          platform === "win32" ||
          (platform === "linux" && env.WSL_DISTRO_NAME)
        ) {
          return "windows";
        }
        throw new Error(
          "NAISYS_DESKTOP_BACKEND=windows requires Windows or WSL.",
        );
      case "macos":
        if (platform === "darwin") return "macos";
        throw new Error("NAISYS_DESKTOP_BACKEND=macos requires macOS.");
      default:
        throw new Error(
          `Unknown NAISYS_DESKTOP_BACKEND '${requested}'. Use auto, windows, macos, x11, or wayland.`,
        );
    }
  }

  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  // Preserve the existing WSL default: control the Windows desktop.
  if (env.WSL_DISTRO_NAME) return "windows";
  if (env.XDG_SESSION_TYPE === "wayland" || env.WAYLAND_DISPLAY)
    return "wayland";
  if (env.XDG_SESSION_TYPE === "x11" || env.DISPLAY) return "x11";
  return null;
}
