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
import { zodResolver } from "@naisys/common-browser";
import type {
  CreateField,
  Field,
  FieldListResponse,
  UpdateField,
} from "@naisys/erp-shared";
import {
  CreateFieldSchema,
  FieldType,
  FieldTypeEnum,
  UpdateFieldSchema,
} from "@naisys/erp-shared";
import { useState } from "react";

import { api, showErrorNotification } from "../lib/api";
import { hasAction } from "../lib/hateoas";
import { MetadataTooltip } from "./MetadataTooltip";

const TYPE_LABELS: Record<string, string> = {
  string: "String",
  number: "Number",
  date: "Date",
  datetime: "Date/Time",
  yesNo: "Yes/No",
  checkbox: "Checkbox",
  attachment: "Attachment",
};

function fieldTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

interface FieldListProps {
  fieldsEndpoint: string;
  fieldEndpoint: (seqNo: number | string) => string;
  initialData: FieldListResponse;
}

export const FieldDefList: React.FC<FieldListProps> = ({
  fieldsEndpoint,
  fieldEndpoint,
  initialData,
}) => {
  const [fields, setFields] = useState<FieldListResponse>(initialData);
  const [editingFieldId, setEditingFieldId] = useState<number | null>(null);
  const [addingField, setAddingField] = useState(false);
  const [saving, setSaving] = useState(false);

  const editForm = useForm<UpdateField>({
    initialValues: {
      seqNo: 10,
      label: "",
      type: FieldType.string,
      isArray: false,
      required: false,
    },
    validate: zodResolver(UpdateFieldSchema),
  });

  const createForm = useForm<CreateField>({
    initialValues: {
      seqNo: 10,
      label: "",
      type: FieldType.string,
      isArray: false,
      required: false,
    },
    validate: zodResolver(CreateFieldSchema),
  });

  const startEditing = (field: Field) => {
    editForm.setValues({
      seqNo: field.seqNo,
      label: field.label,
      type: field.type,
      isArray: field.isArray,
      required: field.required,
    });
    setEditingFieldId(field.id);
    setAddingField(false);
  };

  const handleSave = async (values: UpdateField) => {
    const field = fields.items.find((f) => f.id === editingFieldId);
    if (!field) return;
    setSaving(true);
    try {
      const updated = await api.put<Field>(fieldEndpoint(field.seqNo), values);
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

  const handleDelete = async (field: Field) => {
    if (!confirm(`Delete field "${field.label}"?`)) return;
    try {
      await api.delete(fieldEndpoint(field.seqNo));
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
      type: FieldType.string,
      isArray: false,
      required: false,
    });
    setAddingField(true);
    setEditingFieldId(null);
  };

  const handleCreate = async (values: CreateField) => {
    setSaving(true);
    try {
      const created = await api.post<Field>(fieldsEndpoint, values);
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
    form: ReturnType<typeof useForm<CreateField | UpdateField>>,
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
        data={FieldTypeEnum.options.map((v) => ({
          value: v,
          label: fieldTypeLabel(v),
        }))}
        {...form.getInputProps("type")}
      />
      <Checkbox
        label="Array (accepts multiple values)"
        {...form.getInputProps("isArray", { type: "checkbox" })}
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
        {fields.items.length > 0 && (
          <Text size="xs" fw={600} c="dimmed">
            Data Fields
          </Text>
        )}
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
                  {fieldTypeLabel(field.type)}
                </Badge>
                {field.isArray && (
                  <Badge size="xs" variant="light" color="blue">
                    []
                  </Badge>
                )}
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
