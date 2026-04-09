import {
  ActionIcon,
  Button,
  Checkbox,
  Container,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { hasAction } from "@naisys/common";
import {
  IconCheck,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconInfoCircle,
  IconPencil,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

import type { VariablesResponse } from "../../lib/apiClient";
import { api, apiEndpoints } from "../../lib/apiClient";
import { deleteVariable, saveVariable } from "../../lib/apiVariables";

interface VariableRow {
  key: string;
  value: string;
  exportToShell: boolean;
  sensitive: boolean;
}

export const VariablesPage: React.FC = () => {
  const [data, setData] = useState<VariablesResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // New row state
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newExportToShell, setNewExportToShell] = useState(false);
  const [newSensitive, setNewSensitive] = useState(false);
  const [saving, setSaving] = useState(false);

  // Inline edit state
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editExportToShell, setEditExportToShell] = useState(false);
  const [editSensitive, setEditSensitive] = useState(false);

  // Visibility toggle for sensitive values
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<VariablesResponse>(apiEndpoints.variables);
      setData(result);
    } catch {
      // error handled silently
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const canManage = data ? !!hasAction(data._actions, "save") : false;

  const handleSaveNew = async () => {
    if (!newKey.trim() || !newValue.trim()) return;
    setSaving(true);
    try {
      const result = await saveVariable(
        newKey.trim(),
        newValue.trim(),
        newExportToShell,
        newSensitive,
      );
      if (result.success) {
        setNewKey("");
        setNewValue("");
        setNewExportToShell(false);
        setNewSensitive(false);
        void fetchData();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async (key: string) => {
    setSaving(true);
    try {
      const result = await saveVariable(key, editValue, editExportToShell, editSensitive);
      if (result.success) {
        setEditingKey(null);
        void fetchData();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (key: string) => {
    if (!window.confirm(`Delete variable "${key}"?`)) return;
    const result = await deleteVariable(key);
    if (result.success) {
      void fetchData();
    }
  };

  const startEdit = (row: VariableRow) => {
    setEditingKey(row.key);
    setEditValue(row.value);
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

  return (
    <Container size="lg" py="xl" w="100%">
      <Title order={2} mb="xs">
        Variables
      </Title>
      <Text size="sm" c="dimmed" mb="lg">
        Variables are used by NAISYS itself, LLM configurations, and agent
        prompts. You can define your own to share text across agent prompts.
        Variables marked with export are available to shell commands your agent
        calls.
      </Text>

      {loading ? (
        <Stack align="center" py="xl">
          <Loader />
        </Stack>
      ) : (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Key</Table.Th>
              <Table.Th>Value</Table.Th>
              <Table.Th w={60}>
                <Group gap={4} wrap="nowrap">
                  Shell
                  <Tooltip
                    label="Export this variable into the agent's shell environment. Leave unchecked for variables only used internally by NAISYS (e.g. API keys)."
                    multiline
                    w={250}
                  >
                    <IconInfoCircle size={14} style={{ opacity: 0.5 }} />
                  </Tooltip>
                </Group>
              </Table.Th>
              <Table.Th w={60}>
                <Group gap={4} wrap="nowrap">
                  Sensitive
                  <Tooltip
                    label="Mask this variable's value in the UI. Useful for API keys and secrets."
                    multiline
                    w={250}
                  >
                    <IconInfoCircle size={14} style={{ opacity: 0.5 }} />
                  </Tooltip>
                </Group>
              </Table.Th>
              {canManage && <Table.Th w={100}>Actions</Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {data?.items.map((item) => (
              <Table.Tr key={item.key}>
                <Table.Td>{item.key}</Table.Td>
                <Table.Td>
                  {editingKey === item.key ? (
                    <TextInput
                      value={editValue}
                      onChange={(e) => setEditValue(e.currentTarget.value)}
                      size="xs"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleSaveEdit(item.key);
                        if (e.key === "Escape") cancelEdit();
                      }}
                      autoFocus
                    />
                  ) : (
                    <Group gap={4} wrap="nowrap">
                      <Text size="sm" style={{ fontFamily: "monospace" }}>
                        {item.sensitive && !revealedKeys.has(item.key)
                          ? "••••••••"
                          : item.value}
                      </Text>
                      {item.sensitive && (
                        <>
                          <Tooltip label={revealedKeys.has(item.key) ? "Hide value" : "Show value"}>
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
                  {editingKey === item.key ? (
                    <Checkbox
                      checked={editExportToShell}
                      onChange={(e) =>
                        setEditExportToShell(e.currentTarget.checked)
                      }
                      size="xs"
                    />
                  ) : (
                    <Checkbox checked={item.exportToShell} readOnly size="xs" />
                  )}
                </Table.Td>
                <Table.Td>
                  {editingKey === item.key ? (
                    <Checkbox
                      checked={editSensitive}
                      onChange={(e) =>
                        setEditSensitive(e.currentTarget.checked)
                      }
                      size="xs"
                    />
                  ) : (
                    <Checkbox checked={item.sensitive} readOnly size="xs" />
                  )}
                </Table.Td>
                {canManage && (
                  <Table.Td>
                    <Group gap={4}>
                      {editingKey === item.key ? (
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
            ))}
            {canManage && (
              <Table.Tr>
                <Table.Td>
                  <TextInput
                    placeholder="Key"
                    value={newKey}
                    onChange={(e) => setNewKey(e.currentTarget.value)}
                    size="xs"
                  />
                </Table.Td>
                <Table.Td>
                  <TextInput
                    placeholder="Value"
                    value={newValue}
                    onChange={(e) => setNewValue(e.currentTarget.value)}
                    size="xs"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleSaveNew();
                    }}
                  />
                </Table.Td>
                <Table.Td>
                  <Checkbox
                    checked={newExportToShell}
                    onChange={(e) =>
                      setNewExportToShell(e.currentTarget.checked)
                    }
                    size="xs"
                  />
                </Table.Td>
                <Table.Td>
                  <Checkbox
                    checked={newSensitive}
                    onChange={(e) =>
                      setNewSensitive(e.currentTarget.checked)
                    }
                    size="xs"
                  />
                </Table.Td>
                <Table.Td>
                  <Button
                    size="xs"
                    onClick={handleSaveNew}
                    loading={saving}
                    disabled={!newKey.trim() || !newValue.trim()}
                  >
                    Add
                  </Button>
                </Table.Td>
              </Table.Tr>
            )}
            {(!data || data.items.length === 0) && !canManage && (
              <Table.Tr>
                <Table.Td colSpan={4}>
                  <Text c="dimmed" ta="center" py="md">
                    No variables found.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      )}
    </Container>
  );
};
