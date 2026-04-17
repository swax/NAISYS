import { useSearchParams } from "react-router-dom";

export const useBoomGuard = (scope: string): void => {
  const [searchParams] = useSearchParams();
  if (searchParams.get("boom") === scope) {
    throw new Error(`Boom guard triggered: ${scope}`);
  }
};
