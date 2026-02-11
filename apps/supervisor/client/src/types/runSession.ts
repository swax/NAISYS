import { RunSession as BaseRunSession } from "@naisys-supervisor/shared";

/**
 * Client-side RunSession type with computed properties
 */
export type RunSession = BaseRunSession & {
  isOnline: boolean;
};
