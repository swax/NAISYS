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
import { zodResolver } from "@naisys/common-browser";
import type { CreateOrderRun, UpdateOrderRun } from "@naisys/erp-shared";
import {
  CreateOrderRunSchema,
  OrderRunPriority,
  OrderRunPriorityEnum,
  UpdateOrderRunSchema,
} from "@naisys/erp-shared";
import { useState } from "react";

type FormData<TEdit extends boolean> = TEdit extends true
  ? UpdateOrderRun
  : CreateOrderRun;

interface Props<TEdit extends boolean = boolean> {
  initialData?: Partial<{
    revNo: number;
    priority: string;
    dueAt: string;
    releaseNote: string;
  }>;
  isEdit?: TEdit;
  onSubmit: (data: FormData<TEdit>) => Promise<void>;
  onCancel: () => void;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function transformFormValues(
  values: {
    revNo: number | string;
    priority: string;
    dueAt: string;
    releaseNote: string;
  },
  isEdit?: boolean,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    priority: values.priority || undefined,
    dueAt: values.dueAt || undefined,
    releaseNote: values.releaseNote || undefined,
  };
  if (isEdit) {
    if (!values.dueAt) result.dueAt = null;
    if (!values.releaseNote) result.releaseNote = null;
  } else {
    result.revNo = typeof values.revNo === "number" ? values.revNo : undefined;
  }
  return result;
}

export const OrderRunForm = <TEdit extends boolean = false>({
  initialData,
  isEdit,
  onSubmit,
  onCancel,
}: Props<TEdit>) => {
  const schema = isEdit ? UpdateOrderRunSchema : CreateOrderRunSchema;

  const form = useForm({
    initialValues: {
      revNo: (initialData?.revNo ?? "") as number | string,
      priority: initialData?.priority ?? OrderRunPriority.medium,
      dueAt: initialData?.dueAt ?? (isEdit ? "" : todayStr()),
      releaseNote: initialData?.releaseNote ?? "",
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
          <NumberInput
            label="Rev No"
            placeholder="Latest approved"
            min={1}
            {...form.getInputProps("revNo")}
          />
        )}
        <Select
          label="Priority"
          data={OrderRunPriorityEnum.options.map((v) => ({
            value: v,
            label: v.charAt(0).toUpperCase() + v.slice(1),
          }))}
          {...form.getInputProps("priority")}
        />
        <TextInput
          label="Due Date"
          type="date"
          {...form.getInputProps("dueAt")}
        />
        <Textarea
          label="Release Note"
          placeholder="Additional notes..."
          {...form.getInputProps("releaseNote")}
          autosize
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
