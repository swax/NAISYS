import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";

export type HostPlatform = "macos" | "linux" | "windows" | "wsl";

export interface HostEnvironment {
  platform: HostPlatform;
  osVersion: string;
  shell: string;
  arch: string;
  nodeVersion: string;
}

function detectPlatform(): HostPlatform {
  const p = os.platform();
  if (p === "darwin") return "macos";
  if (p === "win32") return "windows";
  if (process.env.WSL_DISTRO_NAME) return "wsl";
  return "linux";
}

function readOsRelease(): Record<string, string> | null {
  try {
    const text = readFileSync("/etc/os-release", "utf-8");
    const out: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq);
      let value = line.slice(eq + 1);
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
    return out;
  } catch {
    return null;
  }
}

function detectOsVersion(platform: HostPlatform): string {
  if (platform === "macos") {
    try {
      const productVersion = execSync("sw_vers -productVersion", {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
      return `macOS ${productVersion}`;
    } catch {
      return os.release();
    }
  }
  if (platform === "windows") {
    // os.version() returns e.g. "Microsoft Windows 11 Pro"
    return os.version() || `Windows ${os.release()}`;
  }
  // linux or wsl
  const rel = readOsRelease();
  const distro = rel?.PRETTY_NAME || rel?.NAME || "Linux";
  if (platform === "wsl") {
    const wslDistro = process.env.WSL_DISTRO_NAME;
    return wslDistro ? `${distro} (WSL: ${wslDistro})` : `${distro} (WSL)`;
  }
  return distro;
}

function detectShell(platform: HostPlatform): string {
  // Mirrors apps/naisys/src/services/shellPlatform.ts: native Windows uses PowerShell,
  // everything else (including WSL) uses bash.
  return platform === "windows" ? "powershell" : "bash";
}

export function detectHostEnvironment(): HostEnvironment {
  const platform = detectPlatform();
  return {
    platform,
    osVersion: detectOsVersion(platform),
    shell: detectShell(platform),
    arch: os.arch(),
    nodeVersion: process.version,
  };
}
