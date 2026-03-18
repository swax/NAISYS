import { Container, Loader, Stack, Table, Tabs, Title } from "@mantine/core";
import { formatFileSize, hasAction } from "@naisys/common";
import type { AdminInfoResponse } from "@naisys-erp/shared";
import { useCallback, useEffect, useState } from "react";

import { api, apiEndpoints } from "../../lib/api";
import { AttachmentList } from "./AttachmentList";
import { ServerLogViewer } from "./ServerLogViewer";

export const AdminPage: React.FC = () => {
  const [data, setData] = useState<AdminInfoResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<AdminInfoResponse>(apiEndpoints.admin);
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

  const canViewLogs = data ? !!hasAction(data._actions, "view-logs") : false;
  const canViewAttachments = data
    ? !!hasAction(data._actions, "view-attachments")
    : false;

  return (
    <Container size="lg" py="xl" w="100%">
      <Title order={2} mb="lg">
        Admin
      </Title>

      {loading ? (
        <Stack align="center" py="xl">
          <Loader />
        </Stack>
      ) : data ? (
        <Tabs defaultValue="info">
          <Tabs.List>
            <Tabs.Tab value="info">Info</Tabs.Tab>
            {canViewLogs && <Tabs.Tab value="logs">Server Logs</Tabs.Tab>}
            {canViewAttachments && (
              <Tabs.Tab value="attachments">Attachments</Tabs.Tab>
            )}
          </Tabs.List>

          <Tabs.Panel value="info" pt="md">
            <Table striped highlightOnHover>
              <Table.Tbody>
                <Table.Tr>
                  <Table.Td fw={600}>ERP DB Path</Table.Td>
                  <Table.Td>
                    {data.erpDbPath}
                    {data.erpDbSize != null &&
                      ` (${formatFileSize(data.erpDbSize)})`}
                  </Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>
          </Tabs.Panel>

          {canViewLogs && (
            <Tabs.Panel value="logs" pt="md">
              <ServerLogViewer />
            </Tabs.Panel>
          )}

          {canViewAttachments && (
            <Tabs.Panel value="attachments" pt="md">
              <AttachmentList />
            </Tabs.Panel>
          )}
        </Tabs>
      ) : null}
    </Container>
  );
};
