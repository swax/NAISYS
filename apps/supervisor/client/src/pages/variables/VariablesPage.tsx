import {
  ActionIcon,
  Button,
  Container,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { hasAction } from "@naisys/common";
import { IconCheck, IconPencil, IconTrash, IconX } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

import type { VariablesResponse } from "../../lib/apiClient";
import { api, apiEndpoints } from "../../lib/apiClient";
import { deleteVariable,saveVariable } from "../../lib/apiVariables";

interface VariableRow {
  key: string;
  value: string;
}

export const VariablesPage: React.FC = () => {
  const [data, setData] = useState<VariablesResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // New row state
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [saving, setSaving] = useState(false);

  // Inline edit state
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

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
      const result = await saveVariable(newKey.trim(), newValue.trim());
      if (result.success) {
        setNewKey("");
        setNewValue("");
        void fetchData();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async (key: string) => {
    setSaving(true);
    try {
      const result = await saveVariable(key, editValue);
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
  };

  const cancelEdit = () => {
    setEditingKey(null);
  };

  return (
    <Container size="lg" py="xl">
      <Title order={2} mb="lg">
        Variables
      </Title>

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
                    item.value
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
                <Table.Td colSpan={2}>
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
