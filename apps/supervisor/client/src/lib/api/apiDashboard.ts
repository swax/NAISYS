import type { DashboardResponse } from "@naisys/supervisor-shared";

import { api, apiEndpoints } from "./apiClient";

/** Aggregated recent-activity snapshot for the home dashboard. */
export const getDashboard = async (): Promise<DashboardResponse> => {
  return await api.get<DashboardResponse>(apiEndpoints.dashboard);
};
