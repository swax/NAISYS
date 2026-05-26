import {
  Accordion,
  ActionIcon,
  Autocomplete,
  Badge,
  Button,
  Container,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { useSessionStorage } from "@mantine/hooks";
import { defaultCategoryForVariable, hasAction } from "@naisys/common";
import {
  IconCheck,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconInfoCircle,
  IconKey,
  IconLock,
  IconPencil,
  IconTerminal2,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import type { VariablesResponse } from "../../lib/api/apiClient";
import { api, apiEndpoints } from "../../lib/api/apiClient";
import { deleteVariable, saveVariable } from "../../lib/api/apiVariables";
import { CodexOAuthSetupDialog } from "./CodexOAuthSetupDialog";

/** A single variable as returned by the list endpoint. */
type VariableItem = VariablesResponse["items"][number];

/** Accordion panel value standing in for variables with no category. */
const UNCATEGORIZED = "__naisys_uncategorized__";

/** IANA timezone names supported by this runtime; powers the TIMEZONE picker. */
const TIMEZONES = Intl.supportedValuesOf("timeZone");

interface VariableValueInputProps {
  /** `TIMEZONE` renders a timezone picker; every other key gets a text box. */
  variableKey: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  onCancel?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
}

/** Value editor for the variables table. The TIMEZONE key gets a searchable
 *  picker so the saved value is always a valid IANA name — the server rejects
 *  invalid names too, but the picker keeps the UI from ever sending one. */
const VariableValueInput: React.FC<VariableValueInputProps> = ({
  variableKey,
  value,
  onChange,
  onSubmit,
  onCancel,
  placeholder,
  autoFocus,
}) => {
  if (variableKey.trim() === "TIMEZONE") {
    // A previously-saved alias (e.g. "US/Pacific") isn't in the canonical
    // list — keep it selectable so editing doesn't blank a valid value.
    const data =
      value && !TIMEZONES.includes(value) ? [value, ...TIMEZONES] : TIMEZONES;
    return (
      <Select
        data={data}
        value={value || null}
        onChange={(next) => onChange(next ?? "")}
        placeholder={placeholder ?? "Select a timezone"}
        size="xs"
        searchable
        nothingFoundMessage="No matching timezone"
        autoFocus={autoFocus}
      />
    );
  }
  return (
    <TextInput
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.currentTarget.value)}
      size="xs"
      autoFocus={autoFocus}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSubmit?.();
        if (e.key === "Escape") onCancel?.();
      }}
    />
  );
};

export const VariablesPage: React.FC = () => {
  const [oauthOpened, setOauthOpened] = useState(false);

  // New row state
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newCategory, setNewCategory] = useState("");
  // Tracks whether the user hand-edited the category for the new variable;
  // until then it auto-follows the key's known default.
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [newExportToShell, setNewExportToShell] = useState(false);
  const [newSensitive, setNewSensitive] = useState(false);
  const [saving, setSaving] = useState(false);

  // Inline edit state
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editExportToShell, setEditExportToShell] = useState(false);
  const [editSensitive, setEditSensitive] = useState(false);

  // Visibility toggle for sensitive values
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

  // Which category panels are open. sessionStorage-backed so the choice
  // survives navigation; null means "untouched" → every panel starts open.
  const [storedExpanded, setStoredExpanded] = useSessionStorage<
    string[] | null
  >({
    key: "variables-expanded-panels",
    defaultValue: null,
    getInitialValueInEffect: false,
  });

  const {
    data,
    isLoading: loading,
    refetch,
  } = useQuery({
    queryKey: ["variables"],
    queryFn: () => api.get<VariablesResponse>(apiEndpoints.variables),
  });

  const canManage = data ? !!hasAction(data._actions, "save") : false;

  const items = useMemo(() => data?.items ?? [], [data]);

  /** Distinct category names, sorted — feeds the category autocompletes. */
  const categoryOptions = useMemo(() => {
    const names = new Set<string>();
    for (const item of items) {
      if (item.category) names.add(item.category);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [items]);

  /** Variables bucketed into panels by category; uncategorized panel last. */
  const categoryGroups = useMemo(() => {
    const groups = new Map<string, VariableItem[]>();
    for (const item of items) {
      const groupKey = item.category || UNCATEGORIZED;
      const list = groups.get(groupKey);
      if (list) list.push(item);
      else groups.set(groupKey, [item]);
    }
    const ordered = [...groups.keys()]
      .filter((c) => c !== UNCATEGORIZED)
      .sort((a, b) => a.localeCompare(b));
    if (groups.has(UNCATEGORIZED)) ordered.push(UNCATEGORIZED);
    return ordered.map((value) => ({
      value,
      label: value === UNCATEGORIZED ? "Uncategorized" : value,
      items: groups.get(value) ?? [],
    }));
  }, [items]);

  const expandedPanels =
    storedExpanded ?? categoryGroups.map((group) => group.value);

  /** New-variable key field: keep the category in sync with the key's known
   *  default (e.g. OPENAI_API_KEY → "API Keys") until the user edits it. */
  const handleNewKeyChange = (key: string) => {
    setNewKey(key);
    if (!categoryTouched) {
      setNewCategory(defaultCategoryForVariable(key.trim()) ?? "");
    }
  };

  const handleSaveNew = async () => {
    if (!newKey.trim() || !newValue.trim()) return;
    setSaving(true);
    try {
      const result = await saveVariable(
        newKey.trim(),
        newValue.trim(),
        newExportToShell,
        newSensitive,
        newCategory.trim() || null,
      );
      if (result.success) {
        setNewKey("");
        setNewValue("");
        setNewCategory("");
        setCategoryTouched(false);
        setNewExportToShell(false);
        setNewSensitive(false);
        void refetch();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async (key: string) => {
    setSaving(true);
    try {
      const result = await saveVariable(
        key,
        editValue,
        editExportToShell,
        editSensitive,
        editCategory.trim() || null,
      );
      if (result.success) {
        setEditingKey(null);
        void refetch();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (key: string) => {
    if (!window.confirm(`Delete variable "${key}"?`)) return;
    const result = await deleteVariable(key);
    if (result.success) {
      void refetch();
    }
  };

  const startEdit = (row: VariableItem) => {
    setEditingKey(row.key);
    setEditValue(row.value);
    setEditCategory(row.category ?? "");
    setEditExportToShell(row.exportToShell);
    setEditSensitive(row.sensitive);
  };

  const toggleReveal = (key: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const copyToClipboard = async (value: string) => {
    await navigator.clipboard.writeText(value);
  };

  const cancelEdit = () => {
    setEditingKey(null);
  };

  const renderRow = (item: VariableItem) => {
    const isEditing = editingKey === item.key;
    return (
      <Table.Tr key={item.key}>
        <Table.Td>{item.key}</Table.Td>
        <Table.Td>
          {isEditing ? (
            <Stack gap={4}>
              <VariableValueInput
                variableKey={item.key}
                value={editValue}
                onChange={setEditValue}
                onSubmit={() => void handleSaveEdit(item.key)}
                onCancel={cancelEdit}
                autoFocus
              />
              <Autocomplete
                data={categoryOptions}
                value={editCategory}
                onChange={setEditCategory}
                placeholder="Category (leave blank for none)"
                size="xs"
              />
            </Stack>
          ) : (
            <Group gap={4} wrap="nowrap">
              <Text size="sm" style={{ fontFamily: "monospace" }}>
                {item.sensitive && !revealedKeys.has(item.key)
                  ? "••••••••"
                  : item.value}
              </Text>
              {item.sensitive && canManage && (
                <>
                  <Tooltip
                    label={
                      revealedKeys.has(item.key) ? "Hide value" : "Show value"
                    }
                  >
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="gray"
                      onClick={() => toggleReveal(item.key)}
                    >
                      {revealedKeys.has(item.key) ? (
                        <IconEyeOff size={14} />
                      ) : (
                        <IconEye size={14} />
                      )}
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Copy value">
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="gray"
                      onClick={() => copyToClipboard(item.value)}
                    >
                      <IconCopy size={14} />
                    </ActionIcon>
                  </Tooltip>
                </>
              )}
            </Group>
          )}
        </Table.Td>
        <Table.Td>
          <Tooltip label="Exported to the agent's shell environment">
            <ActionIcon
              size="sm"
              variant="transparent"
              color={
                (isEditing ? editExportToShell : item.exportToShell)
                  ? "blue"
                  : "gray"
              }
              onClick={
                isEditing ? () => setEditExportToShell((v) => !v) : undefined
              }
              style={{
                cursor: isEditing ? "pointer" : "default",
                opacity: (isEditing ? editExportToShell : item.exportToShell)
                  ? 1
                  : 0.35,
              }}
            >
              <IconTerminal2 size={18} />
            </ActionIcon>
          </Tooltip>
        </Table.Td>
        <Table.Td>
          <Tooltip label="Value is masked in the UI">
            <ActionIcon
              size="sm"
              variant="transparent"
              color={
                (isEditing ? editSensitive : item.sensitive) ? "orange" : "gray"
              }
              onClick={
                isEditing ? () => setEditSensitive((v) => !v) : undefined
              }
              style={{
                cursor: isEditing ? "pointer" : "default",
                opacity: (isEditing ? editSensitive : item.sensitive)
                  ? 1
                  : 0.35,
              }}
            >
              <IconLock size={18} />
            </ActionIcon>
          </Tooltip>
        </Table.Td>
        {canManage && (
          <Table.Td>
            <Group gap={4}>
              {isEditing ? (
                <>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="green"
                    onClick={() => handleSaveEdit(item.key)}
                    loading={saving}
                  >
                    <IconCheck size={14} />
                  </ActionIcon>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="gray"
                    onClick={cancelEdit}
                  >
                    <IconX size={14} />
                  </ActionIcon>
                </>
              ) : (
                <>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    onClick={() => startEdit(item)}
                  >
                    <IconPencil size={14} />
                  </ActionIcon>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="red"
                    onClick={() => handleDelete(item.key)}
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </>
              )}
            </Group>
          </Table.Td>
        )}
      </Table.Tr>
    );
  };

  return (
    <Container size="lg" py="xl" w="100%">
      <Group justify="space-between" align="center" mb="xs">
        <Title order={2}>Variables</Title>
        {canManage && (
          <Button
            variant="light"
            leftSection={<IconKey size={16} />}
            onClick={() => setOauthOpened(true)}
          >
            OpenAI Codex OAuth Setup
          </Button>
        )}
      </Group>
      <Text size="sm" c="dimmed" mb="lg">
        Variables are used by NAISYS itself, LLM configurations, and agent
        prompts. You can define your own to share text across agent prompts.
        Variables marked with export are available to shell commands your agent
        calls. Assign a category to group them into panels below.
      </Text>

      {canManage && (
        <Paper withBorder p="sm" mb="lg">
          <Group gap="xs" align="center" wrap="nowrap">
            <TextInput
              placeholder="Key"
              value={newKey}
              onChange={(e) => handleNewKeyChange(e.currentTarget.value)}
              size="xs"
              w={180}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <VariableValueInput
                variableKey={newKey}
                value={newValue}
                onChange={setNewValue}
                onSubmit={() => void handleSaveNew()}
                placeholder="Value"
              />
            </div>
            <Autocomplete
              data={categoryOptions}
              value={newCategory}
              onChange={(value) => {
                setNewCategory(value);
                setCategoryTouched(true);
              }}
              placeholder="Category"
              size="xs"
              w={170}
            />
            <Tooltip label="Exported to the agent's shell environment">
              <ActionIcon
                size="sm"
                variant="transparent"
                color={newExportToShell ? "blue" : "gray"}
                onClick={() => setNewExportToShell((v) => !v)}
                style={{
                  cursor: "pointer",
                  opacity: newExportToShell ? 1 : 0.35,
                }}
              >
                <IconTerminal2 size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Value is masked in the UI">
              <ActionIcon
                size="sm"
                variant="transparent"
                color={newSensitive ? "orange" : "gray"}
                onClick={() => setNewSensitive((v) => !v)}
                style={{ cursor: "pointer", opacity: newSensitive ? 1 : 0.35 }}
              >
                <IconLock size={18} />
              </ActionIcon>
            </Tooltip>
            <Button
              size="xs"
              onClick={handleSaveNew}
              loading={saving}
              disabled={!newKey.trim() || !newValue.trim()}
            >
              Add
            </Button>
          </Group>
        </Paper>
      )}

      {loading ? (
        <Stack align="center" py="xl">
          <Loader />
        </Stack>
      ) : categoryGroups.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl">
          No variables found.
        </Text>
      ) : (
        <Accordion
          multiple
          variant="separated"
          value={expandedPanels}
          onChange={setStoredExpanded}
        >
          {categoryGroups.map((group) => (
            <Accordion.Item key={group.value} value={group.value}>
              <Accordion.Control>
                <Group gap="xs">
                  <Text fw={600}>{group.label}</Text>
                  <Badge size="sm" variant="light" color="gray">
                    {group.items.length}
                  </Badge>
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Key</Table.Th>
                      <Table.Th>Value</Table.Th>
                      <Table.Th w={70}>
                        <Group gap={4} wrap="nowrap">
                          Shell
                          <Tooltip
                            label="Export this variable into the agent's shell environment. Leave unchecked for variables only used internally by NAISYS (e.g. API keys)."
                            multiline
                            w={250}
                          >
                            <IconInfoCircle
                              size={14}
                              style={{ opacity: 0.5 }}
                            />
                          </Tooltip>
                        </Group>
                      </Table.Th>
                      <Table.Th w={90}>
                        <Group gap={4} wrap="nowrap">
                          Sensitive
                          <Tooltip
                            label="Mask this variable's value in the UI. Useful for API keys and secrets."
                            multiline
                            w={250}
                          >
                            <IconInfoCircle
                              size={14}
                              style={{ opacity: 0.5 }}
                            />
                          </Tooltip>
                        </Group>
                      </Table.Th>
                      {canManage && <Table.Th w={100}>Actions</Table.Th>}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>{group.items.map(renderRow)}</Table.Tbody>
                </Table>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      )}
      <CodexOAuthSetupDialog
        opened={oauthOpened}
        onClose={() => setOauthOpened(false)}
        onComplete={() => void refetch()}
      />
    </Container>
  );
};
