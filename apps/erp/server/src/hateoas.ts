import type { HateoasAction, HateoasLink } from "@naisys-erp/shared";

const API_PREFIX = "/api/erp";

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
    href: `${API_PREFIX}/openapi.json#/components/schemas/${schemaName}`,
  };
}

export function itemLinks(resource: string, id: number, schemaName: string): HateoasLink[] {
  return [
    selfLink(`/${resource}/${id}`),
    collectionLink(resource),
    schemaLink(schemaName),
  ];
}

export function itemActions(
  resource: string,
  id: number,
  status: string,
): HateoasAction[] {
  const href = `${API_PREFIX}/${resource}/${id}`;
  const actions: HateoasAction[] = [
    {
      rel: "update",
      href,
      method: "PUT",
      title: "Update",
      schema: `${API_PREFIX}/openapi.json#/components/schemas/UpdatePlanningOrder`,
    },
  ];

  if (status === "active") {
    actions.push({
      rel: "archive",
      href,
      method: "PUT",
      title: "Archive",
      body: { status: "archived" },
    });
  } else {
    actions.push({
      rel: "activate",
      href,
      method: "PUT",
      title: "Activate",
      body: { status: "active" },
    });
  }

  actions.push({
    rel: "delete",
    href,
    method: "DELETE",
    title: "Delete",
  });

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
  resource: string,
  page: number,
  pageSize: number,
  total: number,
  filters?: Record<string, string | undefined>,
): HateoasLink[] {
  const basePath = `${API_PREFIX}/${resource}`;
  const totalPages = Math.ceil(total / pageSize);
  const links: HateoasLink[] = [
    {
      rel: "self",
      href: `${basePath}?${buildQuery(page, pageSize, filters)}`,
    },
    {
      rel: "first",
      href: `${basePath}?${buildQuery(1, pageSize, filters)}`,
    },
    {
      rel: "last",
      href: `${basePath}?${buildQuery(Math.max(1, totalPages), pageSize, filters)}`,
    },
  ];

  if (page > 1) {
    links.push({
      rel: "prev",
      href: `${basePath}?${buildQuery(page - 1, pageSize, filters)}`,
    });
  }

  if (page < totalPages) {
    links.push({
      rel: "next",
      href: `${basePath}?${buildQuery(page + 1, pageSize, filters)}`,
    });
  }

  return links;
}

// --- Revision HATEOAS helpers ---

export function revisionCollectionLink(
  parentResource: string,
  parentId: number,
): HateoasLink {
  return {
    rel: "revisions",
    href: `${API_PREFIX}/${parentResource}/${parentId}/revisions`,
    title: "Revisions",
  };
}

export function revisionItemLinks(
  parentResource: string,
  parentId: number,
  revisionId: number,
): HateoasLink[] {
  const basePath = `/${parentResource}/${parentId}/revisions`;
  return [
    selfLink(`${basePath}/${revisionId}`),
    {
      rel: "collection",
      href: `${API_PREFIX}${basePath}`,
      title: "Revisions",
    },
    {
      rel: "parent",
      href: `${API_PREFIX}/${parentResource}/${parentId}`,
      title: "Planning Order",
    },
    schemaLink("PlanningOrderRevision"),
  ];
}

export function revisionItemActions(
  parentResource: string,
  parentId: number,
  revisionId: number,
  status: string,
): HateoasAction[] {
  const href = `${API_PREFIX}/${parentResource}/${parentId}/revisions/${revisionId}`;
  const actions: HateoasAction[] = [];

  if (status === "draft") {
    actions.push(
      {
        rel: "update",
        href,
        method: "PUT",
        title: "Update",
        schema: `${API_PREFIX}/openapi.json#/components/schemas/UpdatePlanningOrderRevision`,
      },
      {
        rel: "approve",
        href: `${href}/approve`,
        method: "POST",
        title: "Approve",
      },
      {
        rel: "delete",
        href,
        method: "DELETE",
        title: "Delete",
      },
    );
  } else if (status === "approved") {
    actions.push({
      rel: "obsolete",
      href: `${href}/obsolete`,
      method: "POST",
      title: "Mark Obsolete",
    });
  }
  // obsolete: no actions

  return actions;
}

export function revisionPaginationLinks(
  parentResource: string,
  parentId: number,
  page: number,
  pageSize: number,
  total: number,
  filters?: Record<string, string | undefined>,
): HateoasLink[] {
  const basePath = `${API_PREFIX}/${parentResource}/${parentId}/revisions`;
  const totalPages = Math.ceil(total / pageSize);
  const links: HateoasLink[] = [
    {
      rel: "self",
      href: `${basePath}?${buildQuery(page, pageSize, filters)}`,
    },
    {
      rel: "first",
      href: `${basePath}?${buildQuery(1, pageSize, filters)}`,
    },
    {
      rel: "last",
      href: `${basePath}?${buildQuery(Math.max(1, totalPages), pageSize, filters)}`,
    },
  ];

  if (page > 1) {
    links.push({
      rel: "prev",
      href: `${basePath}?${buildQuery(page - 1, pageSize, filters)}`,
    });
  }

  if (page < totalPages) {
    links.push({
      rel: "next",
      href: `${basePath}?${buildQuery(page + 1, pageSize, filters)}`,
    });
  }

  return links;
}

// --- Execution Order HATEOAS helpers ---

const EXEC_RESOURCE = "execution/orders";

export function execOrderItemLinks(
  id: number,
  planOrderId: number,
): HateoasLink[] {
  return [
    selfLink(`/${EXEC_RESOURCE}/${id}`),
    collectionLink(EXEC_RESOURCE),
    schemaLink("ExecutionOrder"),
    {
      rel: "planning-order",
      href: `${API_PREFIX}/planning/orders/${planOrderId}`,
      title: "Planning Order",
    },
  ];
}

export function execOrderItemActions(
  id: number,
  status: string,
): HateoasAction[] {
  const href = `${API_PREFIX}/${EXEC_RESOURCE}/${id}`;
  const actions: HateoasAction[] = [];

  if (status === "released") {
    actions.push(
      {
        rel: "update",
        href,
        method: "PUT",
        title: "Update",
        schema: `${API_PREFIX}/openapi.json#/components/schemas/UpdateExecutionOrder`,
      },
      {
        rel: "start",
        href: `${href}/start`,
        method: "POST",
        title: "Start",
      },
      {
        rel: "cancel",
        href: `${href}/cancel`,
        method: "POST",
        title: "Cancel",
      },
      {
        rel: "delete",
        href,
        method: "DELETE",
        title: "Delete",
      },
    );
  } else if (status === "started") {
    actions.push(
      {
        rel: "update",
        href,
        method: "PUT",
        title: "Update",
        schema: `${API_PREFIX}/openapi.json#/components/schemas/UpdateExecutionOrder`,
      },
      {
        rel: "close",
        href: `${href}/close`,
        method: "POST",
        title: "Close",
      },
      {
        rel: "cancel",
        href: `${href}/cancel`,
        method: "POST",
        title: "Cancel",
      },
    );
  }
  // closed/cancelled: no actions

  return actions;
}
