import {
  Button,
  Group,
  Loader,
  Pagination,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { formatFileSize } from "@naisys/common";
import { IconDownload, IconRefresh } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

export interface AttachmentItem {
  id: number;
  filename: string;
  fileSize: number;
  uploadedBy: string;
  createdAt: string;
  [key: string]: unknown;
}

export interface AttachmentListData {
  attachments: AttachmentItem[];
  total: number;
  pageSize: number;
}

export interface AttachmentListProps {
  fetchAttachments: (
    page: number,
    pageSize: number,
  ) => Promise<AttachmentListData>;
  getDownloadUrl: (id: number) => string;
  extraColumns?: {
    header: string;
    render: (attachment: AttachmentItem) => React.ReactNode;
  }[];
}

const PAGE_SIZE = 50;

export const AttachmentList: React.FC<AttachmentListProps> = ({
  fetchAttachments: fetchAttachmentsFn,
  getDownloadUrl,
  extraColumns,
}) => {
  const [data, setData] = useState<AttachmentListData | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  const fetchAttachments = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchAttachmentsFn(page, PAGE_SIZE);
      setData(result);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [page, fetchAttachmentsFn]);

  useEffect(() => {
    void fetchAttachments();
  }, [fetchAttachments]);

  const handleDownload = (id: number, filename: string) => {
    const link = document.createElement("a");
    link.href = getDownloadUrl(id);
    link.download = filename;
    link.click();
  };

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 0;

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
            {data.total} file{data.total !== 1 && "s"}
          </Text>
        )}
      </Group>

      {loading && !data ? (
        <Stack align="center" py="md">
          <Loader size="sm" />
        </Stack>
      ) : data && data.attachments.length > 0 ? (
        <>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Filename</Table.Th>
                <Table.Th>Size</Table.Th>
                {extraColumns?.map((col) => (
                  <Table.Th key={col.header}>{col.header}</Table.Th>
                ))}
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
                  {extraColumns?.map((col) => (
                    <Table.Td key={col.header}>{col.render(att)}</Table.Td>
                  ))}
                  <Table.Td>{att.uploadedBy}</Table.Td>
                  <Table.Td>
                    {new Date(att.createdAt).toLocaleString()}
                  </Table.Td>
                  <Table.Td>
                    <IconDownload size={16} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {totalPages > 1 && (
            <Group justify="center" mt="md">
              <Pagination total={totalPages} value={page} onChange={setPage} />
            </Group>
          )}
        </>
      ) : (
        <Text c="dimmed" ta="center" py="md">
          No attachments found
        </Text>
      )}
    </>
  );
};
