import {
  ActionIcon,
  Anchor,
  Button,
  Checkbox,
  FileButton,
  Group,
  Loader,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { DateInput, DateTimePicker } from "@mantine/dates";
import type {
  FieldAttachment,
  FieldValueEntry,
  HateoasActionTemplate,
  UploadAttachmentResponse,
} from "@naisys-erp/shared";
import { FieldType } from "@naisys-erp/shared";
import {
  IconAlertCircle,
  IconCheck,
  IconFile,
  IconPlus,
  IconTrash,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { api, showErrorNotification } from "../lib/api";

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateTime(d: Date): string {
  return `${formatDate(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
import { hasActionTemplate } from "../lib/hateoas";

/** Composite key for edits map: fieldId + setIndex */
function editKey(fieldId: number, setIndex: number): string {
  return `${fieldId}_${setIndex}`;
}

/** Build edits map from field values */
function buildEdits(fieldValues: FieldValueEntry[]): Record<string, string> {
  return Object.fromEntries(
    fieldValues.map((fv) => [editKey(fv.fieldId, fv.setIndex), fv.value]),
  );
}

type FieldSaveStatus = "saving" | "saved" | "error";

interface FieldValueRunListProps {
  fieldValues: FieldValueEntry[];
  multiSet: boolean;
  completed: boolean;
  _actionTemplates?: HateoasActionTemplate[];
  fieldValueEndpoint: (fieldSeqNo: number | string) => string;
  deleteSetEndpoint: (setIndex: number) => string;
  attachmentEndpoint: (fieldSeqNo: number | string) => string;
  attachmentDownloadUrl: (
    fieldSeqNo: number | string,
    attachmentId: number | string,
  ) => string;
  onSetDeleted: () => void;
}

function StatusIcon({ status }: { status?: FieldSaveStatus }) {
  if (status === "saving") return <Loader size={14} />;
  if (status === "saved") return <IconCheck size={14} color="green" />;
  if (status === "error") return <IconAlertCircle size={14} color="red" />;
  return null;
}

export { buildEdits, editKey };

export const FieldValueRunList: React.FC<FieldValueRunListProps> = ({
  fieldValues: fieldValuesProp,
  multiSet,
  completed,
  _actionTemplates,
  fieldValueEndpoint,
  deleteSetEndpoint,
  attachmentEndpoint,
  attachmentDownloadUrl,
  onSetDeleted,
}) => {
  // --- Internal state ---
  const [fieldValues, setFieldValues] = useState(fieldValuesProp);
  const [edits, setEdits] = useState(() => buildEdits(fieldValuesProp));
  const [fieldStatus, setFieldStatus] = useState<
    Record<string, FieldSaveStatus>
  >({});
  const savedTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [currentSetIndex, setCurrentSetIndex] = useState(0);
  const [deletingSet, setDeletingSet] = useState(false);
  const [uploadingField, setUploadingField] = useState<string | null>(null);

  // Re-sync internal state when prop changes (e.g. parent refetched)
  const prevPropRef = useRef(fieldValuesProp);
  useEffect(() => {
    if (fieldValuesProp !== prevPropRef.current) {
      prevPropRef.current = fieldValuesProp;
      setFieldValues(fieldValuesProp);
      setEdits(buildEdits(fieldValuesProp));
    }
  }, [fieldValuesProp]);

  // --- Field change / save ---

  const onFieldChange = (fieldId: number, setIndex: number, value: string) => {
    const k = editKey(fieldId, setIndex);
    setEdits((prev) => ({ ...prev, [k]: value }));
  };

  const onFieldSaved = (
    fieldId: number,
    setIndex: number,
    updated: FieldValueEntry,
  ) => {
    const k = editKey(fieldId, setIndex);
    setFieldValues((prev) => {
      const exists = prev.some(
        (fv) => fv.fieldId === fieldId && fv.setIndex === setIndex,
      );
      return exists
        ? prev.map((fv) =>
            fv.fieldId === fieldId && fv.setIndex === setIndex ? updated : fv,
          )
        : [...prev, updated];
    });
    setEdits((prev) => ({ ...prev, [k]: updated.value }));
  };

  // --- Set management ---

  const onSetAdded = () => {
    const maxSetIndex = fieldValues.reduce(
      (max, fv) => Math.max(max, fv.setIndex),
      -1,
    );
    const nextSetIndex = maxSetIndex + 1;
    const fieldDefs = fieldValues.filter((fv) => fv.setIndex === 0);
    if (fieldDefs.length === 0) return;

    const newFieldValues: FieldValueEntry[] = fieldDefs.map((fv) => ({
      ...fv,
      setIndex: nextSetIndex,
      value: "",
      validation: fv.required
        ? { valid: false, error: "Required" }
        : { valid: true },
    }));

    setFieldValues((prev) => [...prev, ...newFieldValues]);
  };

  // --- Attachment ---

  const onAttachmentUploaded = (
    fieldId: number,
    setIndex: number,
    attachment: FieldAttachment,
  ) => {
    setFieldValues((prev) =>
      prev.map((fv) =>
        fv.fieldId === fieldId && fv.setIndex === setIndex
          ? { ...fv, attachments: [...(fv.attachments ?? []), attachment] }
          : fv,
      ),
    );
  };

  // Determine distinct set indexes from field values
  const setIndexes = [...new Set(fieldValues.map((fv) => fv.setIndex))].sort(
    (a, b) => a - b,
  );
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
  const currentFieldValues = fieldValues.filter(
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

  const saveFieldValue = async (fv: FieldValueEntry, newValue: string) => {
    const currentValue = fv.value;
    if (newValue === currentValue) return;

    setFieldSaveStatus(fv.fieldId, fv.setIndex, "saving");

    try {
      const updated = await api.put<FieldValueEntry>(
        fieldValueEndpoint(fv.fieldSeqNo),
        { value: newValue, setIndex: fv.setIndex },
      );
      onFieldSaved(fv.fieldId, fv.setIndex, updated);
      setFieldSaveStatus(fv.fieldId, fv.setIndex, "saved");
    } catch (err) {
      showErrorNotification(err);
      setFieldSaveStatus(fv.fieldId, fv.setIndex, "error");
    }
  };

  /** Save immediately (for controls that don't have a blur event) */
  const changeAndSave = (fv: FieldValueEntry, newValue: string) => {
    onFieldChange(fv.fieldId, fv.setIndex, newValue);
    void saveFieldValue(fv, newValue);
  };

  // --- multi-value helpers ---

  const getArrayItems = (value: string): string[] => {
    if (!value) return [""];
    const items = value.split(",");
    return items.length === 0 ? [""] : items;
  };

  const setArrayItem = (fv: FieldValueEntry, index: number, item: string) => {
    const currentValue = edits[editKey(fv.fieldId, fv.setIndex)] ?? fv.value;
    const items = getArrayItems(currentValue);
    items[index] = item;
    onFieldChange(fv.fieldId, fv.setIndex, items.join(","));
  };

  const addArrayItem = (fv: FieldValueEntry) => {
    const currentValue = edits[editKey(fv.fieldId, fv.setIndex)] ?? fv.value;
    const newValue = currentValue ? currentValue + "," : "";
    onFieldChange(fv.fieldId, fv.setIndex, newValue);
  };

  const removeArrayItem = (fv: FieldValueEntry, index: number) => {
    const currentValue = edits[editKey(fv.fieldId, fv.setIndex)] ?? fv.value;
    const items = getArrayItems(currentValue);
    items.splice(index, 1);
    const newValue = items.join(",");
    onFieldChange(fv.fieldId, fv.setIndex, newValue);
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
      await api.delete(deleteSetEndpoint(setIdx));
      // Move to previous set if deleting current
      if (clampedSetIndex >= setIdx && clampedSetIndex > 0) {
        setCurrentSetIndex(clampedSetIndex - 1);
      }
      onSetDeleted();
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setDeletingSet(false);
    }
  };

  // --- attachment upload ---

  const canUploadAttachment = !!hasActionTemplate(
    _actionTemplates,
    "uploadAttachment",
  );

  const handleAttachmentUpload = async (
    fv: FieldValueEntry,
    file: File | null,
  ) => {
    if (!file) return;
    const key = editKey(fv.fieldId, fv.setIndex);
    setUploadingField(key);
    try {
      const result = await api.upload<UploadAttachmentResponse>(
        attachmentEndpoint(fv.fieldSeqNo),
        file,
        { setIndex: String(fv.setIndex) },
      );
      onAttachmentUploaded(fv.fieldId, fv.setIndex, {
        id: result.attachmentId,
        filename: result.filename,
        fileSize: result.fileSize,
      });
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setUploadingField(null);
    }
  };

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function renderAttachmentField(
    fv: FieldValueEntry,
    fieldLabel: string,
    canEdit: boolean,
  ) {
    const attachments = fv.attachments ?? [];
    const key = editKey(fv.fieldId, fv.setIndex);
    const isUploading = uploadingField === key;

    return (
      <Stack key={key} gap={4}>
        <Text size="xs" fw={500}>
          {fieldLabel}
        </Text>
        {attachments.map((att) => (
          <Group key={att.id} gap="xs">
            <IconFile size={14} />
            <Anchor
              size="xs"
              href={attachmentDownloadUrl(fv.fieldSeqNo, att.id)}
              target="_blank"
            >
              {att.filename}
            </Anchor>
            <Text size="xs" c="dimmed">
              ({formatFileSize(att.fileSize)})
            </Text>
          </Group>
        ))}
        {attachments.length === 0 && !canEdit && (
          <Text size="xs" c="dimmed">
            No attachments
          </Text>
        )}
        {canEdit && canUploadAttachment && (
          <FileButton onChange={(file) => handleAttachmentUpload(fv, file)}>
            {(props) => (
              <Button
                {...props}
                size="compact-xs"
                variant="light"
                leftSection={
                  isUploading ? <Loader size={14} /> : <IconUpload size={14} />
                }
                loading={isUploading}
              >
                Upload File
              </Button>
            )}
          </FileButton>
        )}
      </Stack>
    );
  }

  // --- single-value input renderer ---

  function renderInput(
    fv: FieldValueEntry,
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
      case FieldType.date:
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
                d ? (typeof d === "string" ? d : formatDate(d)) : "",
              )
            }
            rightSection={<StatusIcon status={status} />}
          />
        );

      case FieldType.datetime:
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
                d ? (typeof d === "string" ? d : formatDateTime(d)) : "",
              )
            }
            rightSection={<StatusIcon status={status} />}
          />
        );

      case FieldType.yesNo:
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

      case FieldType.checkbox:
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

      case FieldType.attachment:
        // Handled separately by renderAttachmentField
        return null;

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

  function formatReadOnlyValue(fv: FieldValueEntry): string {
    if (!fv.value) return "\u2014";
    switch (fv.type) {
      case FieldType.date:
        return new Date(fv.value + "T00:00:00").toLocaleDateString();
      case FieldType.datetime:
        return new Date(fv.value).toLocaleString();
      case FieldType.checkbox:
        return fv.value === "checked" ? "Checked" : "\u2014";
      default:
        return fv.value;
    }
  }

  const canEdit =
    !completed && !!hasActionTemplate(_actionTemplates, "updateField");

  return (
    <Stack gap="xs" mt="xs">
      <Text size="xs" fw={600} c="dimmed">
        Data Fields
      </Text>

      {/* Set selector bar for multiSet steps */}
      {multiSet && (
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
        const key = editKey(fv.fieldId, fv.setIndex);
        const status = fieldStatus[key];
        const fieldLabel = fv.required ? `${fv.label} *` : fv.label;
        const fieldCanEdit = canEdit;
        const editedValue = edits[key] ?? fv.value;

        // Attachment fields have their own renderer
        if (fv.type === FieldType.attachment) {
          return renderAttachmentField(fv, fieldLabel, fieldCanEdit);
        }

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
                      onFieldChange(fv.fieldId, fv.setIndex, joined);
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
              onTextChange: (v) => onFieldChange(fv.fieldId, fv.setIndex, v),
              onImmediateChange: (v) => changeAndSave(fv, v),
              onBlurSave: () => void saveFieldValue(fv, editedValue),
            })}
          </Group>
        );
      })}
    </Stack>
  );
};
