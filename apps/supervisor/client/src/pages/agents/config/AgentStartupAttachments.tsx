import {
  ActionIcon,
  Alert,
  Anchor,
  Box,
  Button,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { Dropzone } from "@mantine/dropzone";
import { notifications } from "@mantine/notifications";
import { hasAction, type HateoasAction } from "@naisys/common";
import {
  IconCheck,
  IconFile,
  IconPaperclip,
  IconRotateClockwise,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

import {
  deleteStartupAttachment,
  getStartupAttachments,
  renameStartupAttachment,
  uploadStartupAttachment,
} from "../../../lib/api/apiAgents";
import type { StartupAttachment } from "../../../lib/api/apiClient";

interface PendingFile {
  file: File;
  path: string;
}

interface AgentStartupAttachmentsProps {
  username: string;
  /** Reports the configured attachment count so the parent can label its accordion. */
  onCountChange?: (count: number) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const AgentStartupAttachments: React.FC<
  AgentStartupAttachmentsProps
> = ({ username, onCountChange }) => {
  const [items, setItems] = useState<StartupAttachment[]>([]);
  const [actions, setActions] = useState<HateoasAction[] | undefined>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pathEdits, setPathEdits] = useState<Record<string, string>>({});
  const [renamingPath, setRenamingPath] = useState<string | null>(null);

  const canManage = hasAction(actions, "add");

  const fetchItems = useCallback(async () => {
    try {
      const data = await getStartupAttachments(username);
      setItems(data.items);
      setActions(data._actions);
      setPathEdits({});
      onCountChange?.(data.items.length);
    } catch (err) {
      console.error("Error fetching startup attachments:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load attachments",
      );
    } finally {
      setLoading(false);
    }
  }, [username, onCountChange]);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  const handleFilesAdd = (files: File[]) => {
    setPending((prev) => [
      ...prev,
      ...files.map((file) => ({ file, path: file.name })),
    ]);
  };

  const handlePendingPathChange = (index: number, newPath: string) => {
    setPending((prev) =>
      prev.map((p, i) => (i === index ? { ...p, path: newPath } : p)),
    );
  };

  const handlePendingRemove = (index: number) => {
    setPending((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async (index: number) => {
    const target = pending[index];
    if (!target || !target.path.trim()) return;

    setUploadingIndex(index);
    try {
      const result = await uploadStartupAttachment(
        username,
        target.file,
        target.path.trim(),
      );
      if (!result.success) {
        notifications.show({
          title: "Upload failed",
          message: result.message ?? "Unknown error",
          color: "red",
        });
        return;
      }
      setPending((prev) => prev.filter((_, i) => i !== index));
      await fetchItems();
    } catch (err) {
      notifications.show({
        title: "Upload failed",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
      });
    } finally {
      setUploadingIndex(null);
    }
  };

  const handleRename = async (oldPath: string) => {
    const newPath = (pathEdits[oldPath] ?? oldPath).trim();
    if (!newPath || newPath === oldPath) return;

    setRenamingPath(oldPath);
    try {
      const result = await renameStartupAttachment(username, oldPath, newPath);
      if (!result.success) {
        notifications.show({
          title: "Rename failed",
          message: result.message ?? "Unknown error",
          color: "red",
        });
        return;
      }
      await fetchItems();
    } catch (err) {
      notifications.show({
        title: "Rename failed",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
      });
    } finally {
      setRenamingPath(null);
    }
  };

  const handleDelete = async (path: string) => {
    if (!window.confirm(`Remove startup attachment at '${path}'?`)) return;

    setDeletingPath(path);
    try {
      const result = await deleteStartupAttachment(username, path);
      if (!result.success) {
        notifications.show({
          title: "Delete failed",
          message: result.message ?? "Unknown error",
          color: "red",
        });
        return;
      }
      await fetchItems();
    } catch (err) {
      notifications.show({
        title: "Delete failed",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
      });
    } finally {
      setDeletingPath(null);
    }
  };

  if (loading) {
    return (
      <Paper p="md" withBorder>
        <Group>
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            Loading startup attachments...
          </Text>
        </Group>
      </Paper>
    );
  }

  return (
    <Stack gap="sm">
      <Text size="xs" c="dimmed">
        Files copied into the agent&apos;s home directory at startup. The path
        is the full relative location including filename — e.g.
        &lsquo;config/app.json&rsquo; lands at &lsquo;~/config/app.json&rsquo;.
      </Text>

      {error && (
        <Alert
          color="red"
          title="Error"
          onClose={() => setError(null)}
          withCloseButton
        >
          {error}
        </Alert>
      )}

      {canManage && (
        <Dropzone
          onDrop={handleFilesAdd}
          disabled={uploadingIndex !== null}
          style={{ padding: "12px 16px", minHeight: "auto" }}
        >
          <Group gap="xs" style={{ pointerEvents: "none" }}>
            <IconPaperclip size={16} stroke={1.5} />
            <Text size="sm" c="dimmed">
              Drop files here or click to select
            </Text>
          </Group>
        </Dropzone>
      )}

      {pending.length > 0 && (
        <Stack gap="xs">
          {pending.map((p, index) => (
            <Paper key={index} p="sm" withBorder>
              <Group gap="sm" wrap="nowrap">
                <IconFile size={20} />
                <Stack gap={2} style={{ flex: 1 }}>
                  <Text size="sm" fw={500}>
                    {p.file.name}{" "}
                    <Text component="span" size="xs" c="dimmed">
                      ({formatFileSize(p.file.size)})
                    </Text>
                  </Text>
                  <TextInput
                    size="xs"
                    placeholder="Relative path (e.g. config/app.json)"
                    value={p.path}
                    onChange={(e) =>
                      handlePendingPathChange(index, e.currentTarget.value)
                    }
                    disabled={uploadingIndex === index}
                  />
                </Stack>
                <Button
                  size="xs"
                  onClick={() => void handleUpload(index)}
                  loading={uploadingIndex === index}
                  disabled={!p.path.trim() || uploadingIndex !== null}
                >
                  Upload
                </Button>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() => handlePendingRemove(index)}
                  disabled={uploadingIndex === index}
                  aria-label="Remove pending file"
                >
                  <IconX size={16} />
                </ActionIcon>
              </Group>
            </Paper>
          ))}
        </Stack>
      )}

      {items.length === 0 && pending.length === 0 ? (
        <Text size="sm" c="dimmed">
          No startup attachments configured.
        </Text>
      ) : (
        <Stack gap="xs">
          {items.map((item) => {
            const editValue = pathEdits[item.path] ?? item.path;
            const isDirty = editValue.trim() !== item.path;
            const isRenaming = renamingPath === item.path;
            return (
              <Paper key={item.path} p="sm" withBorder>
                <Group gap="sm" wrap="nowrap" align="flex-start">
                  <IconFile size={20} style={{ marginTop: 6 }} />
                  <Box style={{ flex: 1, minWidth: 0 }}>
                    <TextInput
                      size="xs"
                      value={editValue}
                      onChange={(e) => {
                        const value = e.currentTarget.value;
                        setPathEdits((prev) => ({
                          ...prev,
                          [item.path]: value,
                        }));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && isDirty) {
                          e.preventDefault();
                          void handleRename(item.path);
                        }
                        if (e.key === "Escape" && isDirty) {
                          setPathEdits((prev) => {
                            const next = { ...prev };
                            delete next[item.path];
                            return next;
                          });
                        }
                      }}
                      readOnly={!canManage}
                      disabled={isRenaming}
                    />
                    <Group gap="xs" mt={4}>
                      <Text size="xs" c="dimmed">
                        Source:
                      </Text>
                      <Anchor href={item.downloadUrl} size="xs" target="_blank">
                        {item.filename}
                      </Anchor>
                      <Text size="xs" c="dimmed">
                        ({formatFileSize(item.fileSize)})
                      </Text>
                    </Group>
                  </Box>
                  {canManage && isDirty && (
                    <>
                      <Tooltip label="Save (Enter)">
                        <ActionIcon
                          variant="subtle"
                          color="green"
                          onClick={() => void handleRename(item.path)}
                          loading={isRenaming}
                          disabled={renamingPath !== null}
                          aria-label="Save renamed path"
                        >
                          <IconCheck size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Reset (Esc)">
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          onClick={() =>
                            setPathEdits((prev) => {
                              const next = { ...prev };
                              delete next[item.path];
                              return next;
                            })
                          }
                          disabled={isRenaming}
                          aria-label="Reset path"
                        >
                          <IconRotateClockwise size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </>
                  )}
                  {canManage && (
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      onClick={() => void handleDelete(item.path)}
                      loading={deletingPath === item.path}
                      disabled={deletingPath !== null || renamingPath !== null}
                      aria-label="Delete startup attachment"
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  )}
                </Group>
              </Paper>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
};
