import { mimeFromFilename } from "@naisys/common";
import {
  ErrorResponseSchema,
  UploadAttachmentResponseSchema,
} from "@naisys/erp-shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { createReadStream, existsSync, statSync } from "fs";
import { z } from "zod/v4";

import { requirePermission } from "../auth-middleware.js";
import erpDb from "../erpDb.js";
import { conflict, notFound } from "../error-handler.js";
import {
  checkOpRunInProgress,
  checkOrderRunStarted,
  checkWorkCenterAccess,
  resolveStepRun,
} from "../route-helpers.js";
import {
  deleteFieldAttachment,
  getAttachmentFilePath,
  uploadAttachment,
} from "../services/attachment-service.js";
import { ensureStepRunFieldRecord } from "../services/field-service.js";
import {
  findStepRunWithField,
  rebuildAttachmentFieldValue,
  upsertFieldValue,
} from "../services/field-value-service.js";
import { isUserClockedIn } from "../services/labor-ticket-service.js";

const FieldSeqNoParamsSchema = z.object({
  orderKey: z.string(),
  runNo: z.coerce.number().int(),
  seqNo: z.coerce.number().int(),
  stepSeqNo: z.coerce.number().int(),
  setIndex: z.coerce.number().int().optional(),
  fieldSeqNo: z.coerce.number().int(),
});

const AttachmentIdParamsSchema = z.object({
  orderKey: z.string(),
  runNo: z.coerce.number().int(),
  seqNo: z.coerce.number().int(),
  stepSeqNo: z.coerce.number().int(),
  setIndex: z.coerce.number().int().optional(),
  fieldSeqNo: z.coerce.number().int(),
  attachmentId: z.coerce.number().int(),
});

export default function stepFieldAttachmentRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // UPLOAD attachment for a field value
  app.post("/", {
    schema: {
      description:
        "Upload a file attachment for an attachment-type field (multipart/form-data)",
      tags: ["Attachments"],
      params: FieldSeqNoParamsSchema,
      // No body schema — multipart parsed manually
      response: {
        200: UploadAttachmentResponseSchema,
        400: ErrorResponseSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_executor"),
    handler: async (request, reply) => {
      const { orderKey, runNo, seqNo, stepSeqNo, fieldSeqNo } = request.params;
      const userId = request.erpUser!.id;

      const resolved = await resolveStepRun(orderKey, runNo, seqNo, stepSeqNo);
      if (!resolved) {
        return notFound(reply, `Step run not found`);
      }

      const wcErr = await checkWorkCenterAccess(
        resolved.opRun.operationId,
        request.erpUser!,
      );
      if (wcErr) return conflict(reply, wcErr);

      const orderErr = checkOrderRunStarted(resolved.run.status);
      if (orderErr) return conflict(reply, orderErr);

      const opErr = checkOpRunInProgress(resolved.opRun.status);
      if (opErr) return conflict(reply, opErr);

      const clockedIn = await isUserClockedIn(resolved.opRun.id, userId);
      if (!clockedIn)
        return conflict(reply, `You must be clocked in to upload attachments`);

      const stepRun = await findStepRunWithField(
        resolved.stepRun.id,
        resolved.opRun.id,
        fieldSeqNo,
      );
      if (!stepRun) return notFound(reply, `Step run not found`);

      if (stepRun.completed) {
        return conflict(reply, `Cannot upload: step run is completed`);
      }

      const field = stepRun.step.fieldSet?.fields[0];
      if (!field) {
        return notFound(reply, `Step field not found`);
      }

      if (field.type !== "attachment") {
        return reply.code(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: "Field is not an attachment type",
        });
      }

      // Parse multipart — expect a single file field named "file"
      const data = await request.file();
      if (!data) {
        return reply.code(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: "No file uploaded",
        });
      }

      const fileBuffer = await data.toBuffer();
      const filename = data.filename || "unnamed_file";

      // setIndex comes from URL params (via /sets/:setIndex/ path), default 0
      const setIndex = request.params.setIndex ?? 0;

      const fieldRecordId = await ensureStepRunFieldRecord(
        resolved.stepRun.id,
        userId,
      );
      if (!fieldRecordId) {
        return notFound(reply, "Step has no field set");
      }

      // For non-isArray fields, reject if an attachment already exists
      if (!field.isArray) {
        const existing = await erpDb.fieldValue.findUnique({
          where: {
            fieldRecordId_fieldId_setIndex: {
              fieldRecordId,
              fieldId: field.id,
              setIndex,
            },
          },
          select: { _count: { select: { fieldAttachments: true } } },
        });
        if (existing && existing._count.fieldAttachments > 0) {
          return reply.code(400).send({
            statusCode: 400,
            error: "Bad Request",
            message:
              "Field already has an attachment. Delete the existing attachment before uploading a new one, or enable multi-value on the field.",
          });
        }
      }

      // Ensure a FieldValue row exists for this field+set
      await upsertFieldValue(fieldRecordId, field.id, setIndex, "", userId);

      // Find the field value ID
      const fieldValueRow = await erpDb.fieldValue.findUnique({
        where: {
          fieldRecordId_fieldId_setIndex: {
            fieldRecordId,
            fieldId: field.id,
            setIndex,
          },
        },
        select: { id: true },
      });

      if (!fieldValueRow) {
        return notFound(reply, `Step field value not found`);
      }

      const result = await uploadAttachment(
        fileBuffer,
        filename,
        userId,
        fieldValueRow.id,
      );

      // Auto-set the field value to reflect all current attachments
      await rebuildAttachmentFieldValue(
        fieldRecordId,
        field.id,
        setIndex,
        field.isArray,
        userId,
      );

      return {
        attachmentId: result.attachmentId,
        filename: result.filename,
        fileSize: result.fileSize,
      };
    },
  });

  // DOWNLOAD attachment
  fastify.get<{ Params: z.infer<typeof AttachmentIdParamsSchema> }>(
    "/:attachmentId",
    {
      schema: {
        description: "Download an attachment file",
        tags: ["Attachments"],
        params: AttachmentIdParamsSchema,
      },
    },
    async (request, reply) => {
      const attachmentId = Number(request.params.attachmentId);

      const att = await getAttachmentFilePath(attachmentId);
      if (!att) {
        return notFound(reply, `Attachment not found`);
      }

      if (!existsSync(att.filepath)) {
        return notFound(reply, `Attachment file missing from disk`);
      }

      const stat = statSync(att.filepath);
      const mimeType = mimeFromFilename(att.filename);
      const isImage = mimeType.startsWith("image/");

      reply.header("content-type", mimeType);
      reply.header(
        "content-disposition",
        `${isImage ? "inline" : "attachment"}; filename="${att.filename.replace(/"/g, '\\"')}"`,
      );
      reply.header("content-length", stat.size);

      return reply.send(createReadStream(att.filepath));
    },
  );

  // DELETE attachment from a field value
  app.delete("/:attachmentId", {
    schema: {
      description:
        "Delete an attachment from a field (also updates the field value)",
      tags: ["Attachments"],
      params: AttachmentIdParamsSchema,
      response: {
        200: z.object({ deleted: z.literal(true) }),
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_executor"),
    handler: async (request, reply) => {
      const { orderKey, runNo, seqNo, stepSeqNo, fieldSeqNo, attachmentId } =
        request.params;
      const userId = request.erpUser!.id;

      const resolved = await resolveStepRun(orderKey, runNo, seqNo, stepSeqNo);
      if (!resolved) return notFound(reply, "Step run not found");

      const wcErr = await checkWorkCenterAccess(
        resolved.opRun.operationId,
        request.erpUser!,
      );
      if (wcErr) return conflict(reply, wcErr);

      const orderErr = checkOrderRunStarted(resolved.run.status);
      if (orderErr) return conflict(reply, orderErr);

      const opErr = checkOpRunInProgress(resolved.opRun.status);
      if (opErr) return conflict(reply, opErr);

      const clockedIn = await isUserClockedIn(resolved.opRun.id, userId);
      if (!clockedIn)
        return conflict(reply, "You must be clocked in to delete attachments");

      const stepRun = await findStepRunWithField(
        resolved.stepRun.id,
        resolved.opRun.id,
        fieldSeqNo,
      );
      if (!stepRun) return notFound(reply, "Step run not found");

      if (stepRun.completed)
        return conflict(reply, "Cannot delete: step run is completed");

      const field = stepRun.step.fieldSet?.fields[0];
      if (!field) return notFound(reply, "Step field not found");

      const setIndex = request.params.setIndex ?? 0;

      const fieldRecordId = await ensureStepRunFieldRecord(
        resolved.stepRun.id,
        userId,
      );
      if (!fieldRecordId) return notFound(reply, "Step has no field set");

      const fieldValueRow = await erpDb.fieldValue.findUnique({
        where: {
          fieldRecordId_fieldId_setIndex: {
            fieldRecordId,
            fieldId: field.id,
            setIndex,
          },
        },
        select: { id: true },
      });

      if (!fieldValueRow) return notFound(reply, "Field value not found");

      await deleteFieldAttachment(fieldValueRow.id, attachmentId);

      // Rebuild field value to reflect remaining attachments
      await rebuildAttachmentFieldValue(
        fieldRecordId,
        field.id,
        setIndex,
        field.isArray,
        userId,
      );

      return { deleted: true as const };
    },
  });
}
