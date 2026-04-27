import { expect, type APIResponse } from "@playwright/test";

import { ERP_API_BASE } from "../../auth-helper";

export function erpApiPath(path: string): string {
  return `${ERP_API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function expectJson<T>(
  res: APIResponse,
  status: number,
): Promise<T> {
  expect(res.status()).toBe(status);
  return (await res.json()) as T;
}

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
}

export async function expectConflict(
  res: APIResponse,
  message?: string | RegExp,
): Promise<ErrorBody> {
  const body = await expectJson<ErrorBody>(res, 409);
  expect(body.statusCode).toBe(409);
  expect(body.error).toBe("Conflict");
  if (message instanceof RegExp) {
    expect(body.message).toMatch(message);
  } else if (typeof message === "string") {
    expect(body.message).toContain(message);
  } else {
    expect(body.message).toBeTruthy();
  }
  return body;
}

interface ActionLink {
  rel: string;
  disabled?: boolean;
}

export function expectActions(
  body: { _actions?: ActionLink[] },
  rels: string[],
): void {
  expect(body._actions).toEqual(
    expect.arrayContaining(rels.map((rel) => expect.objectContaining({ rel }))),
  );
}

export function expectNoActions(
  body: { _actions?: ActionLink[] },
  rels: string[],
): void {
  for (const rel of rels) {
    expect(body._actions).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ rel })]),
    );
  }
}

export function expectLinks(
  body: { _links?: { rel: string }[] },
  rels: string[],
): void {
  expect(body._links).toEqual(
    expect.arrayContaining(rels.map((rel) => expect.objectContaining({ rel }))),
  );
}
