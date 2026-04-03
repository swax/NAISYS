import type { HateoasAction, HateoasLink } from "@naisys/common";
import {
  CreateItemInstanceSchema,
  DeleteSetMutateResponseSchema,
  ErrorResponseSchema,
  fieldTypeString,
  FieldValueMutateResponseSchema,
  getValueFormatHint,
  ItemInstanceListQuerySchema,
  ItemInstanceListResponseSchema,
  ItemInstanceSchema,
  KeyCreateResponseSchema,
  MutateResponseSchema,
  UpdateFieldValueSchema,
  UpdateItemInstanceSchema,
} from "@naisys-erp/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import type { ErpUser } from "../auth-middleware.js";
import { hasPermission, requirePermission } from "../auth-middleware.js";
import { notFound, unprocessable } from "../error-handler.js";
import {
  API_PREFIX,
  paginationLinks,
  schemaLink,
  selfLink,
} from "../hateoas.js";
import {
  formatAuditFields,
  mutationResult,
  useFullSerializer,
  wantsFullResponse,
} from "../route-helpers.js";
import {
  checkFieldValueShape,
  deleteFieldValueSet,
  deserializeFieldValue,
  serializeFieldValue,
  upsertFieldValue,
  validateFieldValue,
} from "../services/field-value-service.js";
import {
  createItemInstance,
  deleteItemInstance,
  ensureItemInstanceFieldRecord,
  findItemInstance,
  findItemInstanceWithField,
  type ItemInstanceWithRelations,
  listItemInstances,
  updateItemInstance,
} from "../services/item-instance-service.js";
import { findExisting as findItem } from "../services/item-service.js";

const ParamsSchema = z.object({
  key: z.string(),
});

const InstanceParamsSchema = z.object({
  key: z.string(),
  instanceId: z.coerce.number(),
});

const FieldSeqNoParamsSchema = z.object({
  key: z.string(),
  instanceId: z.coerce.number(),
  fieldSeqNo: z.coerce.number().int(),
});

const SetIndexParamsSchema = z.object({
  key: z.string(),
  instanceId: z.coerce.number(),
  setIndex: z.coerce.number().int(),
});

const SetFieldSeqNoParamsSchema = z.object({
  key: z.string(),
  instanceId: z.coerce.number(),
  setIndex: z.coerce.number().int().min(0),
  fieldSeqNo: z.coerce.number().int(),
});

function instanceBasePath(itemKey: string): string {
  return `items/${itemKey}/instances`;
}

function instanceLinks(
  itemKey: string,
  instanceId: number,
  inst: ItemInstanceWithRelations,
): HateoasLink[] {
  const base = instanceBasePath(itemKey);
  const links: HateoasLink[] = [
    selfLink(`/${base}/${instanceId}`),
    {
      rel: "collection",
      href: `${API_PREFIX}/${base}`,
      title: "Instances",
    },
    {
      rel: "parent",
      href: `${API_PREFIX}/items/${itemKey}`,
      title: "Item",
    },
    schemaLink("ItemInstance"),
  ];
  if (inst.orderRun) {
    links.push({
      rel: "orderRun",
      href: `${API_PREFIX}/orders/${inst.orderRun.order.key}/runs/${inst.orderRun.runNo}`,
      title: "Order Run",
    });
  }
  return links;
}

function instanceActions(
  itemKey: string,
  instanceId: number,
  user: ErpUser | undefined,
): HateoasAction[] {
  if (!hasPermission(user, "item_manager")) return [];
  const href = `${API_PREFIX}/${instanceBasePath(itemKey)}/${instanceId}`;
  return [
    {
      rel: "update",
      href,
      method: "PUT",
      title: "Update",
      schema: `${API_PREFIX}/schemas/UpdateItemInstance`,
      body: { key: "" },
    },
    {
      rel: "delete",
      href,
      method: "DELETE",
      title: "Delete",
    },
  ];
}

function orderKey(inst: ItemInstanceWithRelations): string | null {
  return inst.orderRun?.order.key ?? null;
}

function orderRunNo(inst: ItemInstanceWithRelations): number | null {
  return inst.orderRun?.runNo ?? null;
}

function buildFieldValues(inst: ItemInstanceWithRelations) {
  const fields = inst.item.fieldSet?.fields ?? [];
  if (fields.length === 0) return [];

  const storedFieldValues = inst.fieldRecord?.fieldValues ?? [];
  const maxSetIndex = storedFieldValues.reduce(
    (max, fv) => Math.max(max, fv.setIndex),
    -1,
  );
  const setCount = Math.max(1, maxSetIndex + 1);

  const fieldValues: {
    fieldId: number;
    fieldSeqNo: number;
    label: string;
    type: string;
    valueFormat: string;
    required: boolean;
    setIndex: number;
    value: string | string[];
    attachments?: { id: number; filename: string; fileSize: number }[];
    validation: ReturnType<typeof validateFieldValue>;
  }[] = [];

  for (let si = 0; si < setCount; si++) {
    for (const field of fields) {
      const stored = storedFieldValues.find(
        (fv) => fv.fieldId === field.id && fv.setIndex === si,
      );
      const value = deserializeFieldValue(stored?.value ?? "", field.isArray);
      const attachments =
        field.type === "attachment" && stored
          ? stored.fieldAttachments.map((sfa) => sfa.attachment)
          : undefined;
      const fieldType = fieldTypeString(field.type, field.isArray);
      fieldValues.push({
        fieldId: field.id,
        fieldSeqNo: field.seqNo,
        label: field.label,
        type: fieldType,
        valueFormat: getValueFormatHint(fieldType),
        required: field.required,
        setIndex: si,
        value,
        attachments,
        validation: validateFieldValue(
          field.type,
          field.isArray,
          field.required,
          value,
        ),
      });
    }
  }

  return fieldValues;
}

function buildActionTemplates(
  itemKey: string,
  instanceId: number,
  user: ErpUser | undefined,
  hasFields: boolean,
) {
  if (!hasPermission(user, "item_manager") || !hasFields) return [];
  const instanceHref = `${API_PREFIX}/${instanceBasePath(itemKey)}/${instanceId}`;
  return [
    {
      rel: "updateField",
      hrefTemplate: `${instanceHref}/fields/{fieldSeqNo}`,
      method: "PUT" as const,
      title: "Update Field Value",
      schema: `${API_PREFIX}/schemas/UpdateFieldValue`,
      body: { value: "" },
    },
  ];
}

function formatInstance(
  inst: ItemInstanceWithRelations,
  user: ErpUser | undefined,
) {
  const hasFields = (inst.item.fieldSet?.fields ?? []).length > 0;
  return {
    id: inst.id,
    itemKey: inst.item.key,
    orderKey: orderKey(inst),
    orderRunNo: orderRunNo(inst),
    key: inst.key,
    quantity: inst.quantity,
    fieldValues: buildFieldValues(inst),
    ...formatAuditFields(inst),
    _links: instanceLinks(inst.item.key, inst.id, inst),
    _actions: instanceActions(inst.item.key, inst.id, user),
    _actionTemplates: buildActionTemplates(
      inst.item.key,
      inst.id,
      user,
      hasFields,
    ),
  };
}

function formatListInstance(
  inst: ItemInstanceWithRelations,
  _user: ErpUser | undefined,
) {
  return {
    id: inst.id,
    itemKey: inst.item.key,
    orderKey: orderKey(inst),
    orderRunNo: orderRunNo(inst),
    key: inst.key,
    quantity: inst.quantity,
    fieldValues: buildFieldValues(inst),
    ...formatAuditFields(inst),
  };
}

export default function itemInstanceRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // LIST
  app.get("/", {
    schema: {
      description: "List item instances with pagination and search",
      tags: ["Item Instances"],
      params: ParamsSchema,
      querystring: ItemInstanceListQuerySchema,
      response: {
        200: ItemInstanceListResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { key } = request.params;
      const { page, pageSize, search } = request.query;

      const item = await findItem(key);
      if (!item) return notFound(reply, `Item '${key}' not found`);

      const where: Record<string, unknown> = { itemId: item.id };
      if (search) {
        where.key = { contains: search };
      }

      const [instances, total] = await listItemInstances(where, page, pageSize);
      const base = instanceBasePath(key);

      return {
        items: instances.map((inst) =>
          formatListInstance(inst, request.erpUser),
        ),
        total,
        page,
        pageSize,
        _links: paginationLinks(base, page, pageSize, total, { search }),
        _linkTemplates: [
          {
            rel: "item",
            hrefTemplate: `${API_PREFIX}/items/${key}/instances/{id}`,
          },
        ],
        _actions: hasPermission(request.erpUser, "item_manager")
          ? [
              {
                rel: "create",
                href: `${API_PREFIX}/${base}`,
                method: "POST" as const,
                title: "Create Instance",
                schema: `${API_PREFIX}/schemas/CreateItemInstance`,
                body: { key: "" },
              },
            ]
          : [],
      };
    },
  });

  // CREATE
  app.post("/", {
    schema: {
      description: "Create a new item instance",
      tags: ["Item Instances"],
      params: ParamsSchema,
      body: CreateItemInstanceSchema,
      response: {
        201: KeyCreateResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("item_manager"),
    handler: async (request, reply) => {
      const { key: itemKey } = request.params;
      const { key, quantity, orderRunId } = request.body;
      const userId = request.erpUser!.id;

      const item = await findItem(itemKey);
      if (!item) return notFound(reply, `Item '${itemKey}' not found`);

      const inst = await createItemInstance(
        item.id,
        key,
        quantity,
        orderRunId,
        userId,
      );

      const full = formatInstance(inst, request.erpUser);
      reply.status(201);
      return mutationResult(request, reply, full, {
        id: full.id,
        key: full.key,
        _links: full._links,
        _actions: full._actions,
      });
    },
  });

  // GET by id
  app.get("/:instanceId", {
    schema: {
      description: "Get a single item instance",
      tags: ["Item Instances"],
      params: InstanceParamsSchema,
      response: {
        200: ItemInstanceSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { instanceId } = request.params;

      const inst = await findItemInstance(instanceId);
      if (!inst)
        return notFound(reply, `Item instance ${instanceId} not found`);

      return formatInstance(inst, request.erpUser);
    },
  });

  // UPDATE
  app.put("/:instanceId", {
    schema: {
      description: "Update an item instance",
      tags: ["Item Instances"],
      params: InstanceParamsSchema,
      body: UpdateItemInstanceSchema,
      response: {
        200: MutateResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("item_manager"),
    handler: async (request, reply) => {
      const { instanceId } = request.params;
      const data = request.body;
      const userId = request.erpUser!.id;

      const existing = await findItemInstance(instanceId);
      if (!existing)
        return notFound(reply, `Item instance ${instanceId} not found`);

      const inst = await updateItemInstance(instanceId, data, userId);
      const full = formatInstance(inst, request.erpUser);
      return mutationResult(request, reply, full, {
        _actions: full._actions,
      });
    },
  });

  // DELETE
  app.delete("/:instanceId", {
    schema: {
      description: "Delete an item instance",
      tags: ["Item Instances"],
      params: InstanceParamsSchema,
      response: {
        204: z.void(),
        404: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("item_manager"),
    handler: async (request, reply) => {
      const { instanceId } = request.params;

      const existing = await findItemInstance(instanceId);
      if (!existing)
        return notFound(reply, `Item instance ${instanceId} not found`);

      await deleteItemInstance(instanceId);
      reply.status(204);
    },
  });

  // Shared handler for updating a single field value
  async function handleFieldUpdate(request: any, reply: any, setIndex: number) {
    const { instanceId, fieldSeqNo } = request.params;
    const { value } = request.body;
    const userId = request.erpUser!.id;

    const inst = await findItemInstanceWithField(instanceId, fieldSeqNo);
    if (!inst) return notFound(reply, `Item instance ${instanceId} not found`);

    const field = inst.item.fieldSet?.fields[0];
    if (!field) return notFound(reply, `Field not found`);

    const shapeErr = checkFieldValueShape(
      field.label,
      field.type,
      field.isArray,
      value,
    );
    if (shapeErr) return unprocessable(reply, shapeErr);

    const fieldRecordId = await ensureItemInstanceFieldRecord(
      instanceId,
      userId,
    );
    if (!fieldRecordId) return notFound(reply, "Item has no field set");

    await upsertFieldValue(fieldRecordId, field.id, setIndex, value, userId);

    // Return deserialized value
    const responseValue = deserializeFieldValue(
      serializeFieldValue(value),
      field.isArray,
    );

    const validation = validateFieldValue(
      field.type,
      field.isArray,
      field.required,
      responseValue,
    );

    const fieldType = fieldTypeString(field.type, field.isArray);
    const full = {
      fieldId: field.id,
      fieldSeqNo: field.seqNo,
      label: field.label,
      type: fieldType,
      valueFormat: getValueFormatHint(fieldType),
      required: field.required,
      setIndex,
      value: responseValue,
      validation,
    };

    return mutationResult(request, reply, full, {
      value: responseValue,
      validation,
    });
  }

  // UPDATE single field value (implicit set 0)
  app.put("/:instanceId/fields/:fieldSeqNo", {
    schema: {
      description:
        "Update a single field value on an item instance (implicit set 0). " +
        "For multi-set items, use /sets/{setIndex}/fields/{fieldSeqNo} instead.",
      tags: ["Item Instances"],
      params: FieldSeqNoParamsSchema,
      body: UpdateFieldValueSchema,
      response: {
        200: FieldValueMutateResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("item_manager"),
    handler: async (request, reply) => handleFieldUpdate(request, reply, 0),
  });

  // UPDATE single field value (explicit set index)
  app.put("/:instanceId/sets/:setIndex/fields/:fieldSeqNo", {
    schema: {
      description:
        "Update a single field value on a specific set of an item instance",
      tags: ["Item Instances"],
      params: SetFieldSeqNoParamsSchema,
      body: UpdateFieldValueSchema,
      response: {
        200: FieldValueMutateResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("item_manager"),
    handler: async (request, reply) =>
      handleFieldUpdate(request, reply, request.params.setIndex),
  });

  // DELETE a field value set
  app.delete("/:instanceId/sets/:setIndex", {
    schema: {
      description:
        "Delete all field values for a set and re-index remaining sets",
      tags: ["Item Instances"],
      params: SetIndexParamsSchema,
      response: {
        200: DeleteSetMutateResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("item_manager"),
    handler: async (request, reply) => {
      const { instanceId, setIndex } = request.params;

      const existing = await findItemInstance(instanceId);
      if (!existing)
        return notFound(reply, `Item instance ${instanceId} not found`);

      if (!existing.fieldRecord) {
        return notFound(reply, "No field values to delete");
      }
      await deleteFieldValueSet(existing.fieldRecord.id, setIndex);

      const inst = await findItemInstance(instanceId);
      if (!inst)
        return notFound(reply, `Item instance ${instanceId} not found`);

      if (wantsFullResponse(request)) {
        useFullSerializer(reply);
        return formatInstance(inst, request.erpUser) as any;
      }

      // Compute set count from remaining field values
      const storedFieldValues = inst.fieldRecord?.fieldValues ?? [];
      const maxSetIndex = storedFieldValues.reduce(
        (max, fv) => Math.max(max, fv.setIndex),
        -1,
      );
      const setCount = Math.max(1, maxSetIndex + 1);

      return {
        setCount,
        _actions: instanceActions(inst.item.key, inst.id, request.erpUser),
      };
    },
  });
}
