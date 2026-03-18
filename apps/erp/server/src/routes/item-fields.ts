import {
  CreateFieldSchema,
  ErrorResponseSchema,
  FieldListResponseSchema,
  FieldSchema,
  UpdateFieldSchema,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import type { ErpUser } from "../auth-middleware.js";
import { hasPermission, requirePermission } from "../auth-middleware.js";
import erpDb from "../erpDb.js";
import { notFound } from "../error-handler.js";
import { API_PREFIX, selfLink } from "../hateoas.js";
import {
  calcNextSeqNo,
  childItemLinks,
  formatAuditFields,
} from "../route-helpers.js";
import {
  createField,
  deleteField,
  ensureFieldSet,
  type FieldWithUsers,
  findExistingField,
  getField,
  listFields,
  updateField,
} from "../services/field-service.js";
import { findExisting as findExistingItem } from "../services/item-service.js";

const ParamsSchema = z.object({ key: z.string() });
const FieldParamsSchema = z.object({
  key: z.string(),
  fieldSeqNo: z.coerce.number().int(),
});

function fieldBasePath(key: string) {
  return `/items/${key}/fields`;
}

function formatField(
  key: string,
  user: ErpUser | undefined,
  field: FieldWithUsers,
) {
  const base = fieldBasePath(key);
  return {
    id: field.id,
    fieldSetId: field.fieldSetId,
    seqNo: field.seqNo,
    label: field.label,
    type: field.type,
    multiValue: field.multiValue,
    required: field.required,
    ...formatAuditFields(field),
    _links: childItemLinks(
      base,
      field.seqNo,
      "Fields",
      `/items/${key}`,
      "Item",
      "Field",
    ),
    _actions: hasPermission(user, "item_manager")
      ? [
          {
            rel: "update",
            href: `${API_PREFIX}${base}/${field.seqNo}`,
            method: "PUT" as const,
            title: "Update",
            schema: `${API_PREFIX}/schemas/UpdateField`,
          },
          {
            rel: "delete",
            href: `${API_PREFIX}${base}/${field.seqNo}`,
            method: "DELETE" as const,
            title: "Delete",
          },
        ]
      : [],
  };
}

export default function itemFieldRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // LIST
  app.get("/", {
    schema: {
      description: "List fields for an item",
      tags: ["Item Fields"],
      params: ParamsSchema,
      response: {
        200: FieldListResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { key } = request.params;
      const item = await findExistingItem(key);
      if (!item) return notFound(reply, `Item '${key}' not found`);

      const fields = item.fieldSetId ? await listFields(item.fieldSetId) : [];
      const maxSeq = fields.length > 0 ? fields[fields.length - 1].seqNo : 0;
      const base = fieldBasePath(key);
      return {
        items: fields.map((f) => formatField(key, request.erpUser, f)),
        total: fields.length,
        nextSeqNo: calcNextSeqNo(maxSeq),
        _links: [selfLink(base)],
        _actions: hasPermission(request.erpUser, "item_manager")
          ? [
              {
                rel: "create",
                href: `${API_PREFIX}${base}`,
                method: "POST" as const,
                title: "Add Field",
                schema: `${API_PREFIX}/schemas/CreateField`,
              },
            ]
          : [],
      };
    },
  });

  // CREATE
  app.post("/", {
    schema: {
      description: "Create a field for an item",
      tags: ["Item Fields"],
      params: ParamsSchema,
      body: CreateFieldSchema,
      response: {
        201: FieldSchema,
        404: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("item_manager"),
    handler: async (request, reply) => {
      const { key } = request.params;
      const {
        seqNo: requestedSeqNo,
        label,
        type,
        multiValue,
        required,
      } = request.body;
      const userId = request.erpUser!.id;

      const item = await findExistingItem(key);
      if (!item) return notFound(reply, `Item '${key}' not found`);

      let fieldSetId = item.fieldSetId;
      if (!fieldSetId) {
        fieldSetId = await ensureFieldSet(null, userId);
        await erpDb.item.update({
          where: { key },
          data: { fieldSetId },
        });
      }

      const field = await createField(
        fieldSetId,
        { seqNo: requestedSeqNo, label, type, multiValue, required },
        userId,
      );
      reply.status(201);
      return formatField(key, request.erpUser, field);
    },
  });

  // GET
  app.get("/:fieldSeqNo", {
    schema: {
      description: "Get an item field",
      tags: ["Item Fields"],
      params: FieldParamsSchema,
      response: {
        200: FieldSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { key, fieldSeqNo } = request.params;
      const item = await findExistingItem(key);
      if (!item) return notFound(reply, `Item '${key}' not found`);
      if (!item.fieldSetId)
        return notFound(reply, `Field ${fieldSeqNo} not found`);

      const field = await getField(item.fieldSetId, fieldSeqNo);
      if (!field) return notFound(reply, `Field ${fieldSeqNo} not found`);
      return formatField(key, request.erpUser, field);
    },
  });

  // UPDATE
  app.put("/:fieldSeqNo", {
    schema: {
      description: "Update an item field",
      tags: ["Item Fields"],
      params: FieldParamsSchema,
      body: UpdateFieldSchema,
      response: {
        200: FieldSchema,
        404: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("item_manager"),
    handler: async (request, reply) => {
      const { key, fieldSeqNo } = request.params;
      const {
        label,
        type,
        multiValue,
        required,
        seqNo: newSeqNo,
      } = request.body;
      const userId = request.erpUser!.id;

      const item = await findExistingItem(key);
      if (!item) return notFound(reply, `Item '${key}' not found`);
      if (!item.fieldSetId)
        return notFound(reply, `Field ${fieldSeqNo} not found`);

      const existing = await findExistingField(item.fieldSetId, fieldSeqNo);
      if (!existing) return notFound(reply, `Field ${fieldSeqNo} not found`);

      const field = await updateField(
        existing.id,
        { label, type, multiValue, required, seqNo: newSeqNo },
        userId,
      );
      return formatField(key, request.erpUser, field);
    },
  });

  // DELETE
  app.delete("/:fieldSeqNo", {
    schema: {
      description: "Delete an item field",
      tags: ["Item Fields"],
      params: FieldParamsSchema,
      response: {
        204: z.void(),
        404: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("item_manager"),
    handler: async (request, reply) => {
      const { key, fieldSeqNo } = request.params;
      const item = await findExistingItem(key);
      if (!item) return notFound(reply, `Item '${key}' not found`);
      if (!item.fieldSetId)
        return notFound(reply, `Field ${fieldSeqNo} not found`);

      const existing = await findExistingField(item.fieldSetId, fieldSeqNo);
      if (!existing) return notFound(reply, `Field ${fieldSeqNo} not found`);

      await deleteField(existing.id);
      reply.status(204);
    },
  });
}
