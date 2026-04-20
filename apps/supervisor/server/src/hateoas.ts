import type { HateoasLink } from "@naisys/common";

export const API_PREFIX = "/supervisor/api";

export function attachmentUrl(id: string, filename: string): string {
  return `${API_PREFIX}/attachments/${id}/${encodeURIComponent(filename)}`;
}

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

/**
 * Build next/prev HATEOAS links for a timestamp-cursor list endpoint.
 *
 * `next` polls forward using the response timestamp (newest-first filter).
 * `prev` is emitted only when `oldestTimestamp` is given, and fetches older
 * items via `updatedBefore`.
 */
export function timestampCursorLinks(
  basePath: string,
  newTimestamp: string,
  oldestTimestamp?: string,
): HateoasLink[] {
  const fullPath = `${API_PREFIX}${basePath}`;
  const links: HateoasLink[] = [
    {
      rel: "next",
      href: `${fullPath}?updatedSince=${encodeURIComponent(newTimestamp)}`,
      title: "Poll for newer items",
    },
  ];
  if (oldestTimestamp) {
    links.push({
      rel: "prev",
      href: `${fullPath}?updatedBefore=${encodeURIComponent(oldestTimestamp)}`,
      title: "Fetch older items",
    });
  }
  return links;
}

/**
 * Build next/prev HATEOAS links for an id-cursor list endpoint (e.g. log streams).
 *
 * `next` polls forward via `logsAfter` / equivalent key. `prev` is emitted only
 * when `minId` is given, and fetches older items via the "before" key.
 *
 * `extraQuery` is appended to both links (e.g. `limit=200`).
 */
export function idCursorLinks(
  basePath: string,
  afterKey: string,
  beforeKey: string,
  maxId: number,
  minId?: number,
  extraQuery?: string,
): HateoasLink[] {
  const fullPath = `${API_PREFIX}${basePath}`;
  const suffix = extraQuery ? `&${extraQuery}` : "";
  const links: HateoasLink[] = [
    {
      rel: "next",
      href: `${fullPath}?${afterKey}=${maxId}${suffix}`,
      title: "Poll for newer items",
    },
  ];
  if (minId !== undefined) {
    links.push({
      rel: "prev",
      href: `${fullPath}?${beforeKey}=${minId}${suffix}`,
      title: "Fetch older items",
    });
  }
  return links;
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
