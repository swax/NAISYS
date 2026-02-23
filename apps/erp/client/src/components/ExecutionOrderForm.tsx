import {
  Button,
  Group,
  NumberInput,
  Select,
  Stack,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import type {
  CreateExecutionOrder,
  UpdateExecutionOrder,
} from "@naisys-erp/shared";
import {
  CreateExecutionOrderSchema,
  UpdateExecutionOrderSchema,
} from "@naisys-erp/shared";
import { useState } from "react";

import { zodResolver } from "../lib/zod-resolver";

type FormData<TEdit extends boolean> = TEdit extends true
  ? UpdateExecutionOrder
  : CreateExecutionOrder;

interface Props<TEdit extends boolean = boolean> {
  initialData?: Partial<{
    planOrderId: number;
    planOrderRevId: number;
    priority: string;
    scheduledStartAt: string;
    dueAt: string;
    assignedTo: string;
    notes: string;
  }>;
  isEdit?: TEdit;
  onSubmit: (data: FormData<TEdit>) => Promise<void>;
  onCancel: () => void;
}

function toISOOrEmpty(datetimeLocal: string): string | undefined {
  if (!datetimeLocal) return undefined;
  return new Date(datetimeLocal).toISOString();
}

function transformFormValues(
  values: {
    planOrderId: number | string;
    planOrderRevId: number | string;
    priority: string;
    scheduledStartAt: string;
    dueAt: string;
    assignedTo: string;
    notes: string;
  },
  isEdit?: boolean,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    priority: values.priority || undefined,
    scheduledStartAt: toISOOrEmpty(values.scheduledStartAt),
    dueAt: toISOOrEmpty(values.dueAt),
    assignedTo: values.assignedTo || undefined,
    notes: values.notes || undefined,
  };
  if (isEdit) {
    // For updates, convert empty optional fields to null (to clear them)
    if (!values.scheduledStartAt) result.scheduledStartAt = null;
    if (!values.dueAt) result.dueAt = null;
    if (!values.assignedTo) result.assignedTo = null;
    if (!values.notes) result.notes = null;
  } else {
    result.planOrderId =
      typeof values.planOrderId === "number" ? values.planOrderId : undefined;
    result.planOrderRevId =
      typeof values.planOrderRevId === "number"
        ? values.planOrderRevId
        : undefined;
  }
  return result;
}

export const ExecutionOrderForm = <TEdit extends boolean = false>({
  initialData,
  isEdit,
  onSubmit,
  onCancel,
}: Props<TEdit>) => {
  const schema = isEdit
    ? UpdateExecutionOrderSchema
    : CreateExecutionOrderSchema;

  const form = useForm({
    initialValues: {
      planOrderId: (initialData?.planOrderId ?? "") as number | string,
      planOrderRevId: (initialData?.planOrderRevId ?? "") as number | string,
      priority: initialData?.priority ?? "medium",
      scheduledStartAt: initialData?.scheduledStartAt ?? "",
      dueAt: initialData?.dueAt ?? "",
      assignedTo: initialData?.assignedTo ?? "",
      notes: initialData?.notes ?? "",
    },
    validate: (values) =>
      zodResolver(schema)(transformFormValues(values, isEdit)),
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (values: typeof form.values) => {
    setLoading(true);
    setError(null);
    try {
      const transformed = transformFormValues(values, isEdit);
      const parsed = schema.parse(transformed);
      await onSubmit(parsed as FormData<TEdit>);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={form.onSubmit(handleSubmit)}>
      <Stack gap="md">
        {!isEdit && (
          <>
            <NumberInput
              label="Planning Order ID"
              min={1}
              {...form.getInputProps("planOrderId")}
            />
            <NumberInput
              label="Planning Order Revision ID"
              min={1}
              {...form.getInputProps("planOrderRevId")}
            />
          </>
        )}
        <Select
          label="Priority"
          data={[
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
            { value: "critical", label: "Critical" },
          ]}
          {...form.getInputProps("priority")}
        />
        <TextInput
          label="Scheduled Start"
          type="datetime-local"
          {...form.getInputProps("scheduledStartAt")}
        />
        <TextInput
          label="Due Date"
          type="datetime-local"
          {...form.getInputProps("dueAt")}
        />
        <TextInput
          label="Assigned To"
          placeholder="Person or team"
          {...form.getInputProps("assignedTo")}
        />
        <Textarea
          label="Notes"
          placeholder="Additional notes..."
          {...form.getInputProps("notes")}
          minRows={3}
        />
        {error && (
          <div style={{ color: "var(--mantine-color-red-6)" }}>{error}</div>
        )}
        <Group>
          <Button type="submit" loading={loading}>
            {isEdit ? "Save Changes" : "Create"}
          </Button>
          <Button variant="subtle" onClick={onCancel}>
            Cancel
          </Button>
        </Group>
      </Stack>
    </form>
  );
};
