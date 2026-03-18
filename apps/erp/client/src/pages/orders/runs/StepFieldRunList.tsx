import {
  ActionIcon,
  Button,
  Checkbox,
  Group,
  Loader,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { DateInput, DateTimePicker } from "@mantine/dates";
import type { StepFieldValue, StepRun } from "@naisys-erp/shared";
import { StepFieldType } from "@naisys-erp/shared";
import {
  IconAlertCircle,
  IconCheck,
  IconPlus,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useRef, useState } from "react";

import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateTime(d: Date): string {
  return `${formatDate(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
import { hasActionTemplate } from "../../../lib/hateoas";

/** Composite key for edits map: fieldId + setIndex */
function editKey(stepFieldId: number, setIndex: number): string {
  return `${stepFieldId}_${setIndex}`;
}

type FieldSaveStatus = "saving" | "saved" | "error";

interface Props {
  orderKey: string;
  runNo: string;
  seqNo: string;
  step: StepRun;
  edits: Record<string, string>; // editKey → value
  onFieldChange: (stepFieldId: number, setIndex: number, value: string) => void;
  onFieldSaved: (
    stepFieldId: number,
    setIndex: number,
    updated: StepFieldValue,
  ) => void;
  onSetAdded: () => void;
  onSetDeleted: (setIndex: number) => void;
}

function StatusIcon({ status }: { status?: FieldSaveStatus }) {
  if (status === "saving") return <Loader size={14} />;
  if (status === "saved") return <IconCheck size={14} color="green" />;
  if (status === "error") return <IconAlertCircle size={14} color="red" />;
  return null;
}

export { editKey };

export const StepFieldRunList: React.FC<Props> = ({
  orderKey,
  runNo,
  seqNo,
  step,
  edits,
  onFieldChange,
  onFieldSaved,
  onSetAdded,
  onSetDeleted,
}) => {
  const [fieldStatus, setFieldStatus] = useState<
    Record<string, FieldSaveStatus>
  >({});
  const savedTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [currentSetIndex, setCurrentSetIndex] = useState(0);
  const [deletingSet, setDeletingSet] = useState(false);

  // Determine distinct set indexes from field values
  const setIndexes = [
    ...new Set(step.fieldValues.map((fv) => fv.setIndex)),
  ].sort((a, b) => a - b);
  if (setIndexes.length === 0) setIndexes.push(0);

  // Clamp currentSetIndex if sets were deleted
  const clampedSetIndex = Math.min(
    currentSetIndex,
    setIndexes[setIndexes.length - 1],
  );
  if (clampedSetIndex !== currentSetIndex) {
    setCurrentSetIndex(clampedSetIndex);
  }

  // Filter field values for the current set
  const currentFieldValues = step.fieldValues.filter(
    (fv) => fv.setIndex === clampedSetIndex,
  );

  const setFieldSaveStatus = (
    fieldId: number,
    setIdx: number,
    status: FieldSaveStatus,
  ) => {
    const key = editKey(fieldId, setIdx);
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

  const saveFieldValue = async (
    fv: StepFieldValue,
    newValue: string,
  ) => {
    const currentValue = fv.value;
    if (newValue === currentValue) return;

    setFieldSaveStatus(fv.stepFieldId, fv.setIndex, "saving");

    try {
      const updated = await api.put<StepFieldValue>(
        apiEndpoints.stepRunFieldValue(
          orderKey,
          runNo,
          seqNo,
          step.seqNo,
          fv.fieldSeqNo,
        ),
        { value: newValue, setIndex: fv.setIndex },
      );
      onFieldSaved(fv.stepFieldId, fv.setIndex, updated);
      setFieldSaveStatus(fv.stepFieldId, fv.setIndex, "saved");
    } catch (err) {
      showErrorNotification(err);
      setFieldSaveStatus(fv.stepFieldId, fv.setIndex, "error");
    }
  };

  /** Save immediately (for controls that don't have a blur event) */
  const changeAndSave = (fv: StepFieldValue, newValue: string) => {
    onFieldChange(fv.stepFieldId, fv.setIndex, newValue);
    void saveFieldValue(fv, newValue);
  };

  // --- multi-value helpers ---

  const getArrayItems = (value: string): string[] => {
    if (!value) return [""];
    const items = value.split(",");
    return items.length === 0 ? [""] : items;
  };

  const setArrayItem = (fv: StepFieldValue, index: number, item: string) => {
    const currentValue =
      edits[editKey(fv.stepFieldId, fv.setIndex)] ?? fv.value;
    const items = getArrayItems(currentValue);
    items[index] = item;
    onFieldChange(fv.stepFieldId, fv.setIndex, items.join(","));
  };

  const addArrayItem = (fv: StepFieldValue) => {
    const currentValue =
      edits[editKey(fv.stepFieldId, fv.setIndex)] ?? fv.value;
    const newValue = currentValue ? currentValue + "," : "";
    onFieldChange(fv.stepFieldId, fv.setIndex, newValue);
  };

  const removeArrayItem = (fv: StepFieldValue, index: number) => {
    const currentValue =
      edits[editKey(fv.stepFieldId, fv.setIndex)] ?? fv.value;
    const items = getArrayItems(currentValue);
    items.splice(index, 1);
    const newValue = items.join(",");
    onFieldChange(fv.stepFieldId, fv.setIndex, newValue);
    void saveFieldValue(fv, newValue);
  };

  // --- set management ---

  const handleAddSet = () => {
    const nextSetIndex =
      setIndexes.length > 0 ? setIndexes[setIndexes.length - 1] + 1 : 0;
    setCurrentSetIndex(nextSetIndex);
    onSetAdded();
  };

  const handleDeleteSet = async (setIdx: number) => {
    setDeletingSet(true);
    try {
      await api.delete(
        apiEndpoints.stepRunDeleteSet(
          orderKey,
          runNo,
          seqNo,
          step.seqNo,
          setIdx,
        ),
      );
      // Move to previous set if deleting current
      if (clampedSetIndex >= setIdx && clampedSetIndex > 0) {
        setCurrentSetIndex(clampedSetIndex - 1);
      }
      onSetDeleted(setIdx);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setDeletingSet(false);
    }
  };

  // --- single-value input renderer ---

  function renderInput(
    fv: StepFieldValue,
    value: string,
    status: FieldSaveStatus | undefined,
    opts: {
      label?: string;
      onTextChange: (newValue: string) => void;
      onImmediateChange: (newValue: string) => void;
      onBlurSave?: () => void;
    },
  ) {
    const { label, onTextChange, onImmediateChange, onBlurSave } = opts;
    const errorMsg =
      fv.validation && !fv.validation.valid ? fv.validation.error : undefined;

    switch (fv.type) {
      case StepFieldType.date:
        return (
          <DateInput
            label={label}
            size="xs"
            style={{ flex: 1 }}
            valueFormat="YYYY-MM-DD"
            clearable
            error={errorMsg}
            value={value ? new Date(value + "T00:00:00") : null}
            onChange={(d) =>
              onImmediateChange(
                d
                  ? typeof d === "string"
                    ? d
                    : formatDate(d)
                  : "",
              )
            }
            rightSection={<StatusIcon status={status} />}
          />
        );

      case StepFieldType.datetime:
        return (
          <DateTimePicker
            label={label}
            size="xs"
            style={{ flex: 1 }}
            valueFormat="YYYY-MM-DD HH:mm"
            clearable
            error={errorMsg}
            value={value ? new Date(value) : null}
            onChange={(d) =>
              onImmediateChange(
                d
                  ? typeof d === "string"
                    ? d
                    : formatDateTime(d)
                  : "",
              )
            }
            rightSection={<StatusIcon status={status} />}
          />
        );

      case StepFieldType.yesNo:
        return (
          <Group gap="xs" align="center">
            {label && (
              <Text size="xs" fw={500}>
                {label}
              </Text>
            )}
            <Switch
              size="xs"
              onLabel="Yes"
              offLabel="No"
              checked={value === "Yes"}
              onChange={(e) =>
                onImmediateChange(e.currentTarget.checked ? "Yes" : "No")
              }
            />
            <StatusIcon status={status} />
          </Group>
        );

      case StepFieldType.checkbox:
        return (
          <Group gap="xs" align="center">
            <Checkbox
              label={label}
              size="xs"
              checked={value === "checked"}
              onChange={(e) =>
                onImmediateChange(e.currentTarget.checked ? "checked" : "")
              }
            />
            <StatusIcon status={status} />
          </Group>
        );

      default:
        // string, number — plain text input
        return (
          <TextInput
            label={label}
            size="xs"
            style={{ flex: 1 }}
            error={errorMsg}
            value={value}
            onChange={(e) => onTextChange(e.currentTarget.value)}
            onBlur={onBlurSave}
            rightSection={<StatusIcon status={status} />}
          />
        );
    }
  }

  // --- read-only display ---

  function formatReadOnlyValue(fv: StepFieldValue): string {
    if (!fv.value) return "\u2014";
    switch (fv.type) {
      case StepFieldType.date:
        return new Date(fv.value + "T00:00:00").toLocaleDateString();
      case StepFieldType.datetime:
        return new Date(fv.value).toLocaleString();
      case StepFieldType.checkbox:
        return fv.value === "checked" ? "Checked" : "\u2014";
      default:
        return fv.value;
    }
  }

  const canEdit =
    !step.completed && !!hasActionTemplate(step._actionTemplates, "updateField");

  return (
    <Stack gap="xs" mt="xs">
      <Text size="xs" fw={600} c="dimmed">
        Data Fields
      </Text>

      {/* Set selector bar for multiSet steps */}
      {step.multiSet && (
        <Group gap={4}>
          {setIndexes.map((si) => (
            <Button
              key={si}
              size="compact-xs"
              variant={si === clampedSetIndex ? "filled" : "light"}
              onClick={() => setCurrentSetIndex(si)}
            >
              Set {si + 1}
            </Button>
          ))}
          {canEdit && (
            <>
              <ActionIcon
                size="xs"
                variant="subtle"
                onClick={handleAddSet}
                title="Add set"
              >
                <IconPlus size={14} />
              </ActionIcon>
              {setIndexes.length > 1 && (
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  color="red"
                  loading={deletingSet}
                  onClick={() => handleDeleteSet(clampedSetIndex)}
                  title="Delete current set"
                >
                  <IconTrash size={14} />
                </ActionIcon>
              )}
            </>
          )}
        </Group>
      )}

      {currentFieldValues.map((fv) => {
        const key = editKey(fv.stepFieldId, fv.setIndex);
        const status = fieldStatus[key];
        const fieldLabel = fv.required ? `${fv.label} *` : fv.label;
        const fieldCanEdit = canEdit;
        const editedValue = edits[key] ?? fv.value;

        if (!fieldCanEdit) {
          return (
            <Group key={key} gap="xs">
              <Text size="xs" fw={500}>
                {fieldLabel}:
              </Text>
              <Text size="xs">{formatReadOnlyValue(fv)}</Text>
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
            <Stack key={key} gap={4}>
              <Group gap="xs" align="center">
                <Text size="xs" fw={500}>
                  {fieldLabel}
                </Text>
                <StatusIcon status={status} />
              </Group>
              {items.map((item, index) => (
                <Group key={index} gap={4} align="flex-end">
                  {renderInput(fv, item, undefined, {
                    onTextChange: (v) => setArrayItem(fv, index, v),
                    onImmediateChange: (v) => {
                      const newItems = [...items];
                      newItems[index] = v;
                      const joined = newItems.join(",");
                      onFieldChange(fv.stepFieldId, fv.setIndex, joined);
                      void saveFieldValue(fv, joined);
                    },
                    onBlurSave: () => void saveFieldValue(fv, editedValue),
                  })}
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
          <Group key={key} gap="xs" align="flex-end">
            {renderInput(fv, editedValue, status, {
              label: fieldLabel,
              onTextChange: (v) =>
                onFieldChange(fv.stepFieldId, fv.setIndex, v),
              onImmediateChange: (v) => changeAndSave(fv, v),
              onBlurSave: () => void saveFieldValue(fv, editedValue),
            })}
          </Group>
        );
      })}
    </Stack>
  );
};
