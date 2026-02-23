import {
  Button,
  Group,
  Select,
  Stack,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import type {
  CreatePlanningOrder,
  UpdatePlanningOrder,
} from "@naisys-erp/shared";
import {
  CreatePlanningOrderSchema,
  UpdatePlanningOrderSchema,
} from "@naisys-erp/shared";
import { useState } from "react";

import { zodResolver } from "../lib/zod-resolver";

type FormData<TEdit extends boolean> = TEdit extends true
  ? UpdatePlanningOrder
  : CreatePlanningOrder;

interface Props<TEdit extends boolean = boolean> {
  initialData?: {
    name?: string;
    description?: string;
    status?: string;
  };
  isEdit?: TEdit;
  onSubmit: (data: FormData<TEdit>) => Promise<void>;
  onCancel: () => void;
}

export const PlanningOrderForm = <TEdit extends boolean = false>({
  initialData,
  isEdit,
  onSubmit,
  onCancel,
}: Props<TEdit>) => {
  const schema = isEdit ? UpdatePlanningOrderSchema : CreatePlanningOrderSchema;

  const form = useForm({
    initialValues: {
      key: "",
      name: initialData?.name ?? "",
      description: initialData?.description ?? "",
      status: initialData?.status ?? "active",
    },
    validate: zodResolver(schema),
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (values: typeof form.values) => {
    setLoading(true);
    setError(null);
    try {
      const input: Record<string, unknown> = isEdit
        ? {
            name: values.name,
            description: values.description,
            status: values.status,
          }
        : {
            key: values.key,
            name: values.name,
            description: values.description,
          };
      const parsed = schema.parse(input);
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
          <TextInput
            label="Key"
            description="Unique identifier (lowercase, hyphens allowed)"
            placeholder="standard-order"
            {...form.getInputProps("key")}
          />
        )}
        <TextInput
          label="Name"
          placeholder="Standard Order"
          {...form.getInputProps("name")}
        />
        <Textarea
          label="Description"
          placeholder="Describe this planning order..."
          {...form.getInputProps("description")}
          minRows={3}
        />
        {isEdit && (
          <Select
            label="Status"
            data={[
              { value: "active", label: "Active" },
              { value: "archived", label: "Archived" },
            ]}
            {...form.getInputProps("status")}
          />
        )}
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
