import type { Permission } from "@naisys/supervisor-shared";

export interface NavTab {
  path: string;
  label: string;
  permission?: Permission;
}

export const navTabs: NavTab[] = [
  { path: "/agents", label: "Agents" },
  { path: "/hosts", label: "Hosts" },
  { path: "/variables", label: "Variables" },
  { path: "/models", label: "Models" },
  { path: "/costs", label: "Costs" },
  { path: "/users", label: "Users" },
  { path: "/admin", label: "Admin", permission: "supervisor_admin" },
];
