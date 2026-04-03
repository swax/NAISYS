import type { AgentStatus } from "@naisys/common";
import type {
  Agent as BaseAgent,
  Host as BaseHost,
} from "@naisys/supervisor-shared";

/**
 * Client-side Agent type with computed properties
 */
export type Agent = BaseAgent & {
  status: AgentStatus;
};

/**
 * Client-side Host type with computed properties
 */
export type Host = BaseHost & {
  online: boolean;
};
