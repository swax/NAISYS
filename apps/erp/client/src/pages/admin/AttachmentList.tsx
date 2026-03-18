import {
  Button,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { formatFileSize } from "@naisys/common";
import type { AdminAttachmentListResponse } from "@naisys-erp/shared";
import { IconDownload, IconRefresh } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

import { api, apiEndpoints } from "../../lib/api";

export const AttachmentList: React.FC = () => {
  const [data, setData] = useState<AdminAttachmentListResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchAttachments = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<AdminAttachmentListResponse>(
        apiEndpoints.adminAttachments,
      );
      setData(result);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAttachments();
  }, [fetchAttachments]);

  const handleDownload = (id: number, filename: string) => {
    const link = document.createElement("a");
    link.href = apiEndpoints.adminAttachmentDownload(id);
    link.download = filename;
    link.click();
  };

  return (
    <>
      <Title order={3} mt="xl">
        Attachments
      </Title>

      <Group>
        <Button
          size="xs"
          variant="light"
          leftSection={<IconRefresh size={14} />}
          onClick={() => fetchAttachments()}
          loading={loading}
        >
          Refresh
        </Button>
        {data && (
          <Text size="sm" c="dimmed">
            {data.attachments.length} file{data.attachments.length !== 1 && "s"}
          </Text>
        )}
      </Group>

      {loading && !data ? (
        <Stack align="center" py="md">
          <Loader size="sm" />
        </Stack>
      ) : data && data.attachments.length > 0 ? (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Filename</Table.Th>
              <Table.Th>Size</Table.Th>
              <Table.Th>Uploaded By</Table.Th>
              <Table.Th>Date</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {data.attachments.map((att) => (
              <Table.Tr
                key={att.id}
                style={{ cursor: "pointer" }}
                onClick={() => handleDownload(att.id, att.filename)}
              >
                <Table.Td>{att.filename}</Table.Td>
                <Table.Td>{formatFileSize(att.fileSize)}</Table.Td>
                <Table.Td>{att.uploadedBy}</Table.Td>
                <Table.Td>{new Date(att.createdAt).toLocaleString()}</Table.Td>
                <Table.Td>
                  <IconDownload size={16} />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      ) : (
        <Text c="dimmed" ta="center" py="md">
          No attachments found
        </Text>
      )}
    </>
  );
};
