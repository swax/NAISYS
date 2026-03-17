import {
  ActionIcon,
  Group,
  Loader,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import type { StepFieldValue, StepRun } from "@naisys-erp/shared";
import {
  IconAlertCircle,
  IconCheck,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import { useRef, useState } from "react";

import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";
import { hasAction } from "../../../lib/hateoas";

type FieldSaveStatus = "saving" | "saved" | "error";

interface Props {
  orderKey: string;
  runNo: string;
  seqNo: string;
  step: StepRun;
  edits: Record<number, string>; // stepFieldId → value
  onFieldChange: (stepFieldId: number, value: string) => void;
  onFieldSaved: (stepFieldId: number, updated: StepFieldValue) => void;
}

export const StepFieldRunList: React.FC<Props> = ({
  orderKey,
  runNo,
  seqNo,
  step,
  edits,
  onFieldChange,
  onFieldSaved,
}) => {
  const [fieldStatus, setFieldStatus] = useState<
    Record<string, FieldSaveStatus>
  >({});
  const savedTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const setFieldSaveStatus = (fieldId: number, status: FieldSaveStatus) => {
    const key = String(fieldId);
    if (savedTimers.current[key]) {
      clearTimeout(savedTimers.current[key]);
      delete savedTimers.current[key];
    }
    if (status === "saved") {
      savedTimers.current[key] = setTimeout(() => {
        setFieldStatus((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        delete savedTimers.current[key];
      }, 1500);
    }
    setFieldStatus((prev) => ({ ...prev, [key]: status }));
  };

  const saveFieldValue = async (fv: StepFieldValue, newValue: string) => {
    const currentValue = fv.value;
    if (newValue === currentValue) return;

    setFieldSaveStatus(fv.stepFieldId, "saving");

    try {
      const updated = await api.put<StepFieldValue>(
        apiEndpoints.stepRunFieldValue(
          orderKey,
          runNo,
          seqNo,
          step.seqNo,
          fv.fieldSeqNo,
        ),
        { value: newValue },
      );
      onFieldSaved(fv.stepFieldId, updated);
      setFieldSaveStatus(fv.stepFieldId, "saved");
    } catch (err) {
      showErrorNotification(err);
      setFieldSaveStatus(fv.stepFieldId, "error");
    }
  };

  const getArrayItems = (value: string): string[] => {
    if (!value) return [""];
    const items = value.split(",");
    return items.length === 0 ? [""] : items;
  };

  const setArrayItem = (fv: StepFieldValue, index: number, item: string) => {
    const currentValue = edits[fv.stepFieldId] ?? fv.value;
    const items = getArrayItems(currentValue);
    items[index] = item;
    onFieldChange(fv.stepFieldId, items.join(","));
  };

  const addArrayItem = (fv: StepFieldValue) => {
    const currentValue = edits[fv.stepFieldId] ?? fv.value;
    const newValue = currentValue ? currentValue + "," : "";
    onFieldChange(fv.stepFieldId, newValue);
  };

  const removeArrayItem = (fv: StepFieldValue, index: number) => {
    const currentValue = edits[fv.stepFieldId] ?? fv.value;
    const items = getArrayItems(currentValue);
    items.splice(index, 1);
    const newValue = items.join(",");
    onFieldChange(fv.stepFieldId, newValue);
    void saveFieldValue(fv, newValue);
  };

  return (
    <Stack gap="xs" mt="xs">
      <Text size="xs" fw={600} c="dimmed">
        Data Fields
      </Text>
      {step.fieldValues.map((fv) => {
        const status = fieldStatus[String(fv.stepFieldId)];
        const fieldLabel = fv.required ? `${fv.label} *` : fv.label;
        const canEdit = hasAction(fv._actions, "update") && !step.completed;
        const editedValue = edits[fv.stepFieldId] ?? fv.value;

        if (!canEdit) {
          return (
            <Group key={fv.stepFieldId} gap="xs">
              <Text size="xs" fw={500}>
                {fieldLabel}:
              </Text>
              <Text size="xs">
                {fv.value || "—"}
              </Text>
              {fv.validation && !fv.validation.valid && (
                <Text size="xs" c="red">
                  {fv.validation.error}
                </Text>
              )}
            </Group>
          );
        }

        if (fv.multiValue) {
          const items = getArrayItems(editedValue);
          return (
            <Stack key={fv.stepFieldId} gap={4}>
              <Group gap="xs" align="center">
                <Text size="xs" fw={500}>
                  {fieldLabel}
                </Text>
                {status === "saving" ? (
                  <Loader size={14} />
                ) : status === "saved" ? (
                  <IconCheck size={14} color="green" />
                ) : status === "error" ? (
                  <IconAlertCircle size={14} color="red" />
                ) : null}
              </Group>
              {items.map((item, index) => (
                <Group key={index} gap={4} align="flex-end">
                  <TextInput
                    size="xs"
                    style={{ flex: 1 }}
                    value={item}
                    onChange={(e) =>
                      setArrayItem(fv, index, e.currentTarget.value)
                    }
                    onBlur={() => void saveFieldValue(fv, editedValue)}
                  />
                  {items.length > 1 && (
                    <ActionIcon
                      size="xs"
                      variant="subtle"
                      color="red"
                      onClick={() => removeArrayItem(fv, index)}
                      title="Remove item"
                    >
                      <IconX size={14} />
                    </ActionIcon>
                  )}
                </Group>
              ))}
              <Group>
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  onClick={() => addArrayItem(fv)}
                  title="Add item"
                >
                  <IconPlus size={14} />
                </ActionIcon>
              </Group>
              {fv.validation && !fv.validation.valid && (
                <Text size="xs" c="red">
                  {fv.validation.error}
                </Text>
              )}
            </Stack>
          );
        }

        return (
          <Group key={fv.stepFieldId} gap="xs" align="flex-end">
            <TextInput
              label={fieldLabel}
              size="xs"
              style={{ flex: 1 }}
              error={
                fv.validation && !fv.validation.valid
                  ? fv.validation.error
                  : undefined
              }
              value={editedValue}
              onChange={(e) =>
                onFieldChange(fv.stepFieldId, e.currentTarget.value)
              }
              onBlur={() => void saveFieldValue(fv, editedValue)}
              rightSection={
                status === "saving" ? (
                  <Loader size={14} />
                ) : status === "saved" ? (
                  <IconCheck size={14} color="green" />
                ) : status === "error" ? (
                  <IconAlertCircle size={14} color="red" />
                ) : null
              }
            />
          </Group>
        );
      })}
    </Stack>
  );
};
