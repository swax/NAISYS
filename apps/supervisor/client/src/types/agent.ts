import { Agent as BaseAgent } from "shared";

/**
 * Client-side Agent type with computed properties
 */
export type Agent = BaseAgent & {
  online: boolean;
};
