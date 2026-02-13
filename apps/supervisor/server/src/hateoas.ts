import type { HateoasAction, HateoasLink } from "@naisys/common";

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
): HateoasAction[] {
  const href = `${API_PREFIX}/users/${userId}`;
  const actions: HateoasAction[] = [
    {
      rel: "update",
      href,
      method: "PUT",
      title: "Update",
      schema: `${API_PREFIX}/schemas/UpdateUser`,
    },
    {
      rel: "grant-permission",
      href: `${href}/permissions`,
      method: "POST",
      title: "Grant Permission",
      schema: `${API_PREFIX}/schemas/GrantPermission`,
    },
  ];

  if (!isSelf) {
    actions.push({
      rel: "delete",
      href,
      method: "DELETE",
      title: "Delete",
    });
  }

  return actions;
}

export function permissionActions(
  userId: number,
  permission: string,
  isSelf: boolean,
): HateoasAction[] {
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
