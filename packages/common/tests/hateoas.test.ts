import { describe, expect, test } from "vitest";

import {
  type ActionDef,
  resolveActions,
  resolveActionTemplates,
} from "../src/http/hateoas.js";

const allow = () => true;
const deny = () => false;

describe("resolveActions", () => {
  test("builds href from baseHref + path", () => {
    const [action] = resolveActions(
      [{ rel: "self", path: "/x", method: "GET", title: "X" }],
      "/api/things",
      {},
      allow,
    );
    expect(action).toEqual({
      rel: "self",
      href: "/api/things/x",
      method: "GET",
      title: "X",
    });
  });

  test("explicit href overrides baseHref + path", () => {
    const [action] = resolveActions(
      [
        {
          rel: "ext",
          href: "https://other",
          path: "/ignored",
          method: "GET",
          title: "E",
        },
      ],
      "/api",
      {},
      allow,
    );
    expect(action.href).toBe("https://other");
  });

  test("gates an action with disabled + disabledReason when permission is missing", () => {
    const [action] = resolveActions(
      [{ rel: "edit", method: "PUT", title: "Edit", permission: "manage" }],
      "/api",
      {},
      deny,
    );
    expect(action).toMatchObject({
      rel: "edit",
      disabled: true,
      disabledReason: "Requires manage permission",
    });
  });

  test("leaves an action enabled when permission is granted", () => {
    const [action] = resolveActions(
      [{ rel: "edit", method: "PUT", title: "Edit", permission: "manage" }],
      "/api",
      {},
      allow,
    );
    expect(action.disabled).toBeUndefined();
  });

  test("omits the action entirely with hideWithoutPermission", () => {
    const actions = resolveActions(
      [
        {
          rel: "secret",
          method: "GET",
          title: "S",
          permission: "manage",
          hideWithoutPermission: true,
        },
      ],
      "/api",
      {},
      deny,
    );
    expect(actions).toEqual([]);
  });

  test("respects visibleWhen and statuses guards", () => {
    const defs: ActionDef<{ status?: string }>[] = [
      { rel: "a", method: "GET", title: "A", visibleWhen: () => false },
      { rel: "b", method: "GET", title: "B", statuses: ["running"] },
    ];
    expect(resolveActions(defs, "/api", { status: "stopped" }, allow)).toEqual(
      [],
    );
    expect(
      resolveActions(defs, "/api", { status: "running" }, allow).map(
        (a) => a.rel,
      ),
    ).toEqual(["b"]);
  });

  test("disabledWhen disables a permitted action with its reason", () => {
    const [action] = resolveActions(
      [
        {
          rel: "del",
          method: "DELETE",
          title: "Del",
          disabledWhen: () => "Busy",
        },
      ],
      "/api",
      {},
      allow,
    );
    expect(action).toMatchObject({ disabled: true, disabledReason: "Busy" });
  });

  test("passes through schema, body, and alternateEncoding", () => {
    const [action] = resolveActions(
      [
        {
          rel: "upload",
          method: "POST",
          title: "Upload",
          schema: "/schemas/Upload",
          body: { name: "" },
          alternateEncoding: {
            contentType: "multipart/form-data",
            fileFields: ["file"],
          },
        },
      ],
      "/api",
      {},
      allow,
    );
    expect(action.schema).toBe("/schemas/Upload");
    expect(action.body).toEqual({ name: "" });
    expect(action.alternateEncoding).toEqual({
      contentType: "multipart/form-data",
      fileFields: ["file"],
    });
  });
});

describe("resolveActionTemplates", () => {
  test("builds hrefTemplate from baseHref + path, preserving placeholders", () => {
    const [tpl] = resolveActionTemplates(
      [{ rel: "item", path: "/{id}", method: "DELETE", title: "Remove" }],
      "/api/things",
      {},
      allow,
    );
    expect(tpl).toEqual({
      rel: "item",
      hrefTemplate: "/api/things/{id}",
      method: "DELETE",
      title: "Remove",
    });
  });

  test("explicit hrefTemplate overrides baseHref + path", () => {
    const [tpl] = resolveActionTemplates(
      [
        {
          rel: "item",
          hrefTemplate: "/custom/{id}",
          path: "/ignored",
          method: "GET",
          title: "I",
        },
      ],
      "/api",
      {},
      allow,
    );
    expect(tpl.hrefTemplate).toBe("/custom/{id}");
  });

  test("gates a template with disabled + disabledReason when permission is missing", () => {
    const [tpl] = resolveActionTemplates(
      [
        {
          rel: "del",
          path: "/{id}",
          method: "DELETE",
          title: "Del",
          permission: "manage",
        },
      ],
      "/api",
      {},
      deny,
    );
    expect(tpl).toMatchObject({
      disabled: true,
      disabledReason: "Requires manage permission",
    });
  });

  test("omits a template entirely with hideWithoutPermission", () => {
    expect(
      resolveActionTemplates(
        [
          {
            rel: "x",
            path: "/{id}",
            method: "GET",
            title: "X",
            permission: "manage",
            hideWithoutPermission: true,
          },
        ],
        "/api",
        {},
        deny,
      ),
    ).toEqual([]);
  });

  test("passes through schema, body, and alternateEncoding", () => {
    const [tpl] = resolveActionTemplates(
      [
        {
          rel: "replace",
          path: "/{id}/content",
          method: "PUT",
          title: "Replace",
          schema: "/schemas/Replace",
          body: { newPath: "" },
          alternateEncoding: {
            contentType: "multipart/form-data",
            fileFields: ["file"],
          },
        },
      ],
      "/api",
      {},
      allow,
    );
    expect(tpl.schema).toBe("/schemas/Replace");
    expect(tpl.body).toEqual({ newPath: "" });
    expect(tpl.alternateEncoding).toEqual({
      contentType: "multipart/form-data",
      fileFields: ["file"],
    });
  });
});
