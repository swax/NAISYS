import type { HateoasAction, HateoasLink } from "@naisys/common";
import { isAgentActive } from "./services/hubConnectionService.js";

const API_PREFIX = "/api/supervisor";

export function selfLink(path: string, title?: string): HateoasLink {
  return { rel: "self", href: `${API_PREFIX}${path}`, title };
}

export function collectionLink(resource: string): HateoasLink {
  return {
    rel: "collection",
    href: `${API_PREFIX}/${resource}`,
    title: resource,
  };
}

export function schemaLink(schemaName: string): HateoasLink {
  return {
    rel: "schema",
    href: `${API_PREFIX}/schemas/${schemaName}`,
  };
}

export function userItemLinks(userId: number): HateoasLink[] {
  return [
    selfLink(`/users/${userId}`),
    collectionLink("users"),
    schemaLink("UpdateUser"),
  ];
}

export function userActions(
  userId: number,
  isSelf: boolean,
  isAdmin: boolean,
): HateoasAction[] {
  const href = `${API_PREFIX}/users/${userId}`;
  const actions: HateoasAction[] = [];

  // Admins can update any user; non-admins can update themselves (password only)
  if (isAdmin || isSelf) {
    actions.push({
      rel: "update",
      href,
      method: "PUT",
      title: isSelf && !isAdmin ? "Change Password" : "Update",
      schema: `${API_PREFIX}/schemas/UpdateUser`,
    });
  }

  if (isAdmin) {
    actions.push({
      rel: "grant-permission",
      href: `${href}/permissions`,
      method: "POST",
      title: "Grant Permission",
      schema: `${API_PREFIX}/schemas/GrantPermission`,
    });

    if (!isSelf) {
      actions.push({
        rel: "delete",
        href,
        method: "DELETE",
        title: "Delete",
      });
    }
  }

  return actions;
}

export function permissionActions(
  userId: number,
  permission: string,
  isSelf: boolean,
  isAdmin: boolean,
): HateoasAction[] {
  if (!isAdmin) return [];

  const actions: HateoasAction[] = [];

  // Cannot revoke own supervisor_admin
  if (!(isSelf && permission === "supervisor_admin")) {
    actions.push({
      rel: "revoke",
      href: `${API_PREFIX}/users/${userId}/permissions/${permission}`,
      method: "DELETE",
      title: "Revoke",
    });
  }

  return actions;
}

export function agentActions(
  agentId: number,
  hasManagePermission: boolean,
  archived: boolean,
): HateoasAction[] {
  const actions: HateoasAction[] = [];
  const active = isAgentActive(agentId);

  if (hasManagePermission && !active && !archived) {
    actions.push({
      rel: "start",
      href: `${API_PREFIX}/agents/${agentId}/start`,
      method: "POST",
      title: "Start Agent",
    });
  }
  if (hasManagePermission && active) {
    actions.push({
      rel: "stop",
      href: `${API_PREFIX}/agents/${agentId}/stop`,
      method: "POST",
      title: "Stop Agent",
    });
  }
  if (hasManagePermission && !active && !archived) {
    actions.push({
      rel: "archive",
      href: `${API_PREFIX}/agents/${agentId}/archive`,
      method: "POST",
      title: "Archive Agent",
    });
  }
  if (hasManagePermission && archived) {
    actions.push({
      rel: "unarchive",
      href: `${API_PREFIX}/agents/${agentId}/unarchive`,
      method: "POST",
      title: "Unarchive Agent",
    });
  }
  if (hasManagePermission && !active && archived) {
    actions.push({
      rel: "delete",
      href: `${API_PREFIX}/agents/${agentId}`,
      method: "DELETE",
      title: "Delete Agent",
    });
  }
  return actions;
}

function buildQuery(
  page: number,
  pageSize: number,
  filters?: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined) params.set(key, value);
    }
  }
  return params.toString();
}

export function paginationLinks(
  basePath: string,
  page: number,
  pageSize: number,
  total: number,
  filters?: Record<string, string | undefined>,
): HateoasLink[] {
  const fullPath = `${API_PREFIX}/${basePath}`;
  const totalPages = Math.ceil(total / pageSize);
  const links: HateoasLink[] = [
    {
      rel: "self",
      href: `${fullPath}?${buildQuery(page, pageSize, filters)}`,
    },
    {
      rel: "first",
      href: `${fullPath}?${buildQuery(1, pageSize, filters)}`,
    },
    {
      rel: "last",
      href: `${fullPath}?${buildQuery(Math.max(1, totalPages), pageSize, filters)}`,
    },
  ];

  if (page > 1) {
    links.push({
      rel: "prev",
      href: `${fullPath}?${buildQuery(page - 1, pageSize, filters)}`,
    });
  }

  if (page < totalPages) {
    links.push({
      rel: "next",
      href: `${fullPath}?${buildQuery(page + 1, pageSize, filters)}`,
    });
  }

  return links;
}
