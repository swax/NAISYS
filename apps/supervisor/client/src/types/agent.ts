import { Agent as BaseAgent, Host as BaseHost } from "shared";

/**
 * Client-side Agent type with computed properties
 */
export type Agent = BaseAgent & {
  online: boolean;
};

/**
 * Client-side Host type with computed properties
 */
export type Host = BaseHost & {
  online: boolean;
};
