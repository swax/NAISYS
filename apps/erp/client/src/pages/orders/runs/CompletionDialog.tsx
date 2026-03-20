import {
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  NumberInput,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { DateInput, DateTimePicker } from "@mantine/dates";
import type { Field, FieldListResponse, OrderRun } from "@naisys-erp/shared";
import { FieldType } from "@naisys-erp/shared";
import { useEffect, useState } from "react";

import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateTime(d: Date): string {
  return `${formatDate(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

interface Props {
  opened: boolean;
  onClose: () => void;
  orderRun: OrderRun;
  orderKey: string;
  runNo: string;
  onCompleted: (orderRun: OrderRun) => void;
}

export const CompletionDialog: React.FC<Props> = ({
  opened,
  onClose,
  orderRun,
  orderKey,
  runNo,
  onCompleted,
}) => {
  const [instanceKey, setInstanceKey] = useState("");
  const [quantity, setQuantity] = useState<number | string>("");
  const [fields, setFields] = useState<Field[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Fetch field definitions when dialog opens
  useEffect(() => {
    if (!opened || !orderRun.itemKey) return;

    setLoading(true);
    api
      .get<FieldListResponse>(apiEndpoints.itemFields(orderRun.itemKey))
      .then((res) => {
        setFields(res.items);
        // Initialize field values with empty strings
        const initial: Record<number, string> = {};
        for (const f of res.items) {
          initial[f.id] = "";
        }
        setFieldValues(initial);
      })
      .catch(showErrorNotification)
      .finally(() => setLoading(false));
  }, [opened, orderRun.itemKey]);

  const handleClose = () => {
    setInstanceKey("");
    setQuantity("");
    setFieldValues({});
    onClose();
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const body: {
        instanceKey?: string;
        quantity?: number | null;
        fieldValues?: { fieldId: number; value: string }[];
      } = {};

      if (instanceKey.trim()) {
        body.instanceKey = instanceKey.trim();
      }
      if (typeof quantity === "number") {
        body.quantity = quantity;
      }

      const fvArray = Object.entries(fieldValues)
        .filter(([, value]) => value !== "")
        .map(([fieldId, value]) => ({
          fieldId: Number(fieldId),
          value,
        }));
      if (fvArray.length > 0) {
        body.fieldValues = fvArray;
      }

      const updated = await api.post<OrderRun>(
        apiEndpoints.orderRunComplete(orderKey, runNo),
        body,
      );
      onCompleted(updated);
      handleClose();
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setSubmitting(false);
    }
  };

  const setFieldValue = (fieldId: number, value: string) => {
    setFieldValues((prev) => ({ ...prev, [fieldId]: value }));
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title="Complete Order Run"
      size="md"
    >
      <Stack gap="md">
        <TextInput
          label="Instance Key (SN / Lot Code)"
          placeholder="Leave blank to auto-generate"
          value={instanceKey}
          onChange={(e) => setInstanceKey(e.currentTarget.value)}
          data-autofocus
        />
        <NumberInput
          label="Quantity"
          placeholder="Optional"
          value={quantity}
          onChange={setQuantity}
          min={0}
          decimalScale={4}
        />

        {loading && (
          <Group justify="center">
            <Loader size="sm" />
          </Group>
        )}

        {fields.length > 0 && (
          <>
            <Text size="sm" fw={600} c="dimmed">
              Item Fields
            </Text>
            {fields.map((field) => {
              const value = fieldValues[field.id] ?? "";
              const label = field.required ? `${field.label} *` : field.label;

              switch (field.type) {
                case FieldType.date:
                  return (
                    <DateInput
                      key={field.id}
                      label={label}
                      size="sm"
                      valueFormat="YYYY-MM-DD"
                      clearable
                      value={value ? new Date(value + "T00:00:00") : null}
                      onChange={(d) =>
                        setFieldValue(
                          field.id,
                          d ? (typeof d === "string" ? d : formatDate(d)) : "",
                        )
                      }
                    />
                  );
                case FieldType.datetime:
                  return (
                    <DateTimePicker
                      key={field.id}
                      label={label}
                      size="sm"
                      valueFormat="YYYY-MM-DD HH:mm"
                      clearable
                      value={value ? new Date(value) : null}
                      onChange={(d) =>
                        setFieldValue(
                          field.id,
                          d
                            ? typeof d === "string"
                              ? d
                              : formatDateTime(d)
                            : "",
                        )
                      }
                    />
                  );
                case FieldType.yesNo:
                  return (
                    <Group key={field.id} gap="xs" align="center">
                      <Text size="sm" fw={500}>
                        {label}
                      </Text>
                      <Switch
                        size="sm"
                        onLabel="Yes"
                        offLabel="No"
                        checked={value === "Yes"}
                        onChange={(e) =>
                          setFieldValue(
                            field.id,
                            e.currentTarget.checked ? "Yes" : "No",
                          )
                        }
                      />
                    </Group>
                  );
                case FieldType.checkbox:
                  return (
                    <Checkbox
                      key={field.id}
                      label={label}
                      size="sm"
                      checked={value === "checked"}
                      onChange={(e) =>
                        setFieldValue(
                          field.id,
                          e.currentTarget.checked ? "checked" : "",
                        )
                      }
                    />
                  );
                case FieldType.number:
                  return (
                    <TextInput
                      key={field.id}
                      label={label}
                      size="sm"
                      type="number"
                      value={value}
                      onChange={(e) =>
                        setFieldValue(field.id, e.currentTarget.value)
                      }
                    />
                  );
                default:
                  return (
                    <TextInput
                      key={field.id}
                      label={label}
                      size="sm"
                      value={value}
                      onChange={(e) =>
                        setFieldValue(field.id, e.currentTarget.value)
                      }
                    />
                  );
              }
            })}
          </>
        )}

        <Group justify="flex-end">
          <Button variant="subtle" onClick={handleClose}>
            Cancel
          </Button>
          <Button color="green" onClick={handleSubmit} loading={submitting}>
            Complete
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
