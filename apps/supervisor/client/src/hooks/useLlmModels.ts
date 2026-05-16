import type { LlmModelDetail, ModelsResponse } from "@naisys/supervisor-shared";
import { useQuery } from "@tanstack/react-query";

import { api, apiEndpoints } from "../lib/api/apiClient";

export const useLlmModels = (): LlmModelDetail[] => {
  const { data } = useQuery({
    queryKey: ["models-data"],
    queryFn: () => api.get<ModelsResponse>(apiEndpoints.models),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  return data?.llmModelDetails ?? [];
};
