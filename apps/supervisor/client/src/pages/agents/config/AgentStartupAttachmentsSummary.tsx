import { Anchor, Group, Stack, Text } from "@mantine/core";
import { IconFile } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { getStartupAttachments } from "../../../lib/api/apiAgents";
import type { StartupAttachment } from "../../../lib/api/apiClient";

interface Props {
  username: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const AgentStartupAttachmentsSummary: React.FC<Props> = ({
  username,
}) => {
  const [items, setItems] = useState<StartupAttachment[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getStartupAttachments(username)
      .then((data) => {
        if (!cancelled) {
          setItems(data.items);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  if (!loaded || items.length === 0) return null;

  return (
    <Stack gap={4}>
      <Text fw={600} size="sm" c="dimmed">
        Startup Attachments
      </Text>
      <Stack gap={2}>
        {items.map((item) => (
          <Group key={item.path} gap="xs" wrap="nowrap">
            <IconFile size={14} />
            <Anchor
              href={item.downloadUrl}
              size="sm"
              target="_blank"
              style={{ fontFamily: "monospace" }}
            >
              {item.path}
            </Anchor>
            <Text size="xs" c="dimmed">
              ({formatFileSize(item.fileSize)})
            </Text>
          </Group>
        ))}
      </Stack>
    </Stack>
  );
};
