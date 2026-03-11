import {
  Badge,
  Button,
  Checkbox,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import type {
  CreateStepField,
  StepField,
  StepFieldListResponse,
  UpdateStepField,
} from "@naisys-erp/shared";
import {
  CreateStepFieldSchema,
  UpdateStepFieldSchema,
} from "@naisys-erp/shared";
import { useState } from "react";

import { MetadataTooltip } from "../../../components/MetadataTooltip";
import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";
import { hasAction } from "../../../lib/hateoas";
import { zodResolver } from "../../../lib/zod-resolver";

interface StepFieldListProps {
  orderKey: string;
  revNo: string;
  opSeqNo: string;
  stepSeqNo: number;
  initialData: StepFieldListResponse;
}

export const StepFieldList: React.FC<StepFieldListProps> = ({
  orderKey,
  revNo,
  opSeqNo,
  stepSeqNo,
  initialData,
}) => {
  const [fields, setFields] = useState<StepFieldListResponse>(initialData);
  const [editingFieldId, setEditingFieldId] = useState<number | null>(null);
  const [addingField, setAddingField] = useState(false);
  const [saving, setSaving] = useState(false);

  const editForm = useForm<UpdateStepField>({
    initialValues: { seqNo: 10, label: "", type: "string", required: false },
    validate: zodResolver(UpdateStepFieldSchema),
  });

  const createForm = useForm<CreateStepField>({
    initialValues: { seqNo: 10, label: "", type: "string", required: false },
    validate: zodResolver(CreateStepFieldSchema),
  });

  const startEditing = (field: StepField) => {
    editForm.setValues({
      seqNo: field.seqNo,
      label: field.label,
      type: field.type as "string" | "number",
      required: field.required,
    });
    setEditingFieldId(field.id);
    setAddingField(false);
  };

  const handleSave = async (values: UpdateStepField) => {
    const field = fields.items.find((f) => f.id === editingFieldId);
    if (!field) return;
    setSaving(true);
    try {
      const updated = await api.put<StepField>(
        apiEndpoints.orderRevOpStepField(
          orderKey,
          revNo,
          opSeqNo,
          stepSeqNo,
          field.seqNo,
        ),
        values,
      );
      setEditingFieldId(null);
      setFields({
        ...fields,
        items: fields.items
          .map((f) => (f.id === updated.id ? updated : f))
          .sort((a, b) => a.seqNo - b.seqNo),
      });
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (field: StepField) => {
    if (!confirm(`Delete field "${field.label}"?`)) return;
    try {
      await api.delete(
        apiEndpoints.orderRevOpStepField(
          orderKey,
          revNo,
          opSeqNo,
          stepSeqNo,
          field.seqNo,
        ),
      );
      setFields({
        ...fields,
        items: fields.items.filter((f) => f.id !== field.id),
        total: fields.total - 1,
      });
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const startAdding = () => {
    createForm.setValues({
      seqNo: fields.nextSeqNo,
      label: "",
      type: "string",
      required: false,
    });
    setAddingField(true);
    setEditingFieldId(null);
  };

  const handleCreate = async (values: CreateStepField) => {
    setSaving(true);
    try {
      const created = await api.post<StepField>(
        apiEndpoints.orderRevOpStepFields(orderKey, revNo, opSeqNo, stepSeqNo),
        values,
      );
      setAddingField(false);
      setFields({
        ...fields,
        items: [...fields.items, created].sort((a, b) => a.seqNo - b.seqNo),
        total: fields.total + 1,
        nextSeqNo: created.seqNo + 10,
      });
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setSaving(false);
    }
  };

  const fieldFormFields = (
    form: ReturnType<typeof useForm<CreateStepField | UpdateStepField>>,
  ) => (
    <>
      <NumberInput
        label="Sequence #"
        min={1}
        step={10}
        {...form.getInputProps("seqNo")}
      />
      <TextInput
        label="Label"
        placeholder="Field label..."
        {...form.getInputProps("label")}
      />
      <Select
        label="Type"
        data={[
          { value: "string", label: "String" },
          { value: "number", label: "Number" },
          { value: "string[]", label: "String List" },
        ]}
        {...form.getInputProps("type")}
      />
      <Checkbox
        label="Required"
        {...form.getInputProps("required", { type: "checkbox" })}
      />
    </>
  );

  return (
    <Stack gap="xs" mt="xs">
      <Group justify="space-between">
        <Text size="xs" fw={600} c="dimmed">
          Data Fields
        </Text>
        {hasAction(fields._actions, "create") && !addingField && (
          <Button size="compact-xs" variant="subtle" onClick={startAdding}>
            Add Field
          </Button>
        )}
      </Group>

      {fields.items.map((field) => (
        <div key={field.id}>
          {editingFieldId === field.id ? (
            <form onSubmit={editForm.onSubmit(handleSave)}>
              <Stack gap="xs">
                {fieldFormFields(editForm as any)}
                <Group justify="flex-end">
                  <Button
                    variant="subtle"
                    size="compact-xs"
                    onClick={() => setEditingFieldId(null)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" size="compact-xs" loading={saving}>
                    Save
                  </Button>
                </Group>
              </Stack>
            </form>
          ) : (
            <Group justify="space-between" wrap="nowrap">
              <Group gap="xs">
                <Text size="xs">{field.seqNo}.</Text>
                <Text size="xs" fw={500}>
                  {field.label}
                </Text>
                <Badge size="xs" variant="light">
                  {field.type}
                </Badge>
                {field.required && (
                  <Badge size="xs" variant="light" color="red">
                    required
                  </Badge>
                )}
              </Group>
              <Group gap={4} wrap="nowrap">
                <MetadataTooltip
                  createdBy={field.createdBy}
                  createdAt={field.createdAt}
                  updatedBy={field.updatedBy}
                  updatedAt={field.updatedAt}
                />
                {hasAction(field._actions, "update") && (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    onClick={() => startEditing(field)}
                  >
                    Edit
                  </Button>
                )}
                {hasAction(field._actions, "delete") && (
                  <Button
                    size="compact-xs"
                    color="red"
                    variant="subtle"
                    onClick={() => handleDelete(field)}
                  >
                    Delete
                  </Button>
                )}
              </Group>
            </Group>
          )}
        </div>
      ))}

      {fields.items.length === 0 && !addingField && (
        <Text size="xs" c="dimmed">
          No data fields.
        </Text>
      )}

      {addingField && (
        <form onSubmit={createForm.onSubmit(handleCreate)}>
          <Stack gap="xs">
            {fieldFormFields(createForm as any)}
            <Group justify="flex-end">
              <Button
                variant="subtle"
                size="compact-xs"
                onClick={() => setAddingField(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="compact-xs" loading={saving}>
                Add
              </Button>
            </Group>
          </Stack>
        </form>
      )}
    </Stack>
  );
};
