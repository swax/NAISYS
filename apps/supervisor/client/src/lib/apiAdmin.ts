import type { RotateAccessKeyResult } from "./apiClient";
import { api, API_BASE, apiEndpoints } from "./apiClient";

export async function rotateHubAccessKey(): Promise<RotateAccessKeyResult> {
  return api.post<Record<string, never>, RotateAccessKeyResult>(
    apiEndpoints.adminRotateAccessKey,
    {},
  );
}

export async function downloadExportConfig(): Promise<void> {
  const response = await fetch(`${API_BASE}${apiEndpoints.adminExportConfig}`);

  if (!response.ok) {
    throw new Error(`Export failed: ${response.status}`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "naisys-config.zip";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
