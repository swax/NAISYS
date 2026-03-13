import {
  Autocomplete,
  Button,
  Group,
  Select,
  Stack,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useDebouncedValue } from "@mantine/hooks";
import type {
  CreateOrder,
  ItemListResponse,
  UpdateOrder,
} from "@naisys-erp/shared";
import {
  CreateOrderSchema,
  OrderStatus,
  OrderStatusEnum,
  UpdateOrderSchema,
} from "@naisys-erp/shared";
import { useCallback, useEffect, useState } from "react";

import { api, apiEndpoints } from "../lib/api";
import { zodResolver } from "../lib/zod-resolver";

type FormData<TEdit extends boolean> = TEdit extends true
  ? UpdateOrder
  : CreateOrder;

interface Props<TEdit extends boolean = boolean> {
  initialData?: {
    key?: string;
    description?: string;
    status?: string;
    itemKey?: string | null;
  };
  isEdit?: TEdit;
  onSubmit: (data: FormData<TEdit>) => Promise<void>;
  onCancel: () => void;
}

export const OrderForm = <TEdit extends boolean = false>({
  initialData,
  isEdit,
  onSubmit,
  onCancel,
}: Props<TEdit>) => {
  const schema = isEdit ? UpdateOrderSchema : CreateOrderSchema;

  const form = useForm({
    initialValues: {
      key: initialData?.key ?? "",
      description: initialData?.description ?? "",
      status: initialData?.status ?? OrderStatus.active,
      itemKey: initialData?.itemKey ?? "",
    },
    validate: zodResolver(schema),
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [itemOptions, setItemOptions] = useState<string[]>([]);
  const [debouncedItemKey] = useDebouncedValue(form.values.itemKey, 300);

  const fetchItemOptions = useCallback(async (search: string) => {
    try {
      const params = new URLSearchParams();
      params.set("pageSize", "10");
      if (search) params.set("search", search);
      const result = await api.get<ItemListResponse>(
        `${apiEndpoints.items}?${params}`,
      );
      setItemOptions(result.items.map((i) => i.key));
    } catch {
      setItemOptions([]);
    }
  }, []);

  useEffect(() => {
    void fetchItemOptions(debouncedItemKey);
  }, [debouncedItemKey, fetchItemOptions]);

  const handleSubmit = async (values: typeof form.values) => {
    setLoading(true);
    setError(null);
    try {
      const input: Record<string, unknown> = isEdit
        ? {
            key: values.key,
            description: values.description,
            status: values.status,
            itemKey: values.itemKey || null,
          }
        : {
            key: values.key,
            description: values.description,
            itemKey: values.itemKey || undefined,
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
        <TextInput
          label="Key"
          description="Unique identifier (alphanumeric, hyphens allowed)"
          placeholder="standard-order"
          {...form.getInputProps("key")}
        />
        <Autocomplete
          label="Produces Item"
          placeholder="Search by item key..."
          data={itemOptions}
          {...form.getInputProps("itemKey")}
        />
        <Textarea
          label="Description"
          placeholder="Describe this order..."
          {...form.getInputProps("description")}
          autosize
          minRows={3}
        />
        {isEdit && (
          <Select
            label="Status"
            data={OrderStatusEnum.options.map((v) => ({
              value: v,
              label: v.charAt(0).toUpperCase() + v.slice(1),
            }))}
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
