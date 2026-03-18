import {
  Badge,
  Button,
  Container,
  Group,
  Loader,
  Stack,
  Table,
  Tabs,
  Title,
  Tooltip,
} from "@mantine/core";
import { formatFileSize, hasAction } from "@naisys/common";
import { IconInfoCircle } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

import { SecretField } from "../../components/SecretField";
import { downloadExportConfig, rotateHubAccessKey } from "../../lib/apiAdmin";
import type { AdminInfoResponse } from "../../lib/apiClient";
import { api, apiEndpoints } from "../../lib/apiClient";
import { AttachmentList } from "./AttachmentList";
import { ServerLogViewer } from "./ServerLogViewer";

export const AdminPage: React.FC = () => {
  const [data, setData] = useState<AdminInfoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [rotating, setRotating] = useState(false);

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

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadExportConfig();
    } finally {
      setExporting(false);
    }
  };

  const handleRotateAccessKey = async () => {
    const confirmed = window.confirm(
      "This will generate a new hub access key and disconnect all clients. " +
        "All NAISYS instances will need their HUB_ACCESS_KEY environment " +
        "variable updated in their .env file before they can reconnect.",
    );
    if (!confirmed) return;

    setRotating(true);
    try {
      const result = await rotateHubAccessKey();
      if (result.success) {
        void fetchData();
      }
    } finally {
      setRotating(false);
    }
  };

  const canExport = data ? !!hasAction(data._actions, "export-config") : false;
  const canViewLogs = data ? !!hasAction(data._actions, "view-logs") : false;
  const canRotateKey = data
    ? !!hasAction(data._actions, "rotate-access-key")
    : false;
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
            <Stack>
              <Table striped highlightOnHover>
                <Table.Tbody>
                  <Table.Tr>
                    <Table.Td fw={600}>Supervisor DB Path</Table.Td>
                    <Table.Td>
                      {data.supervisorDbPath}
                      {data.supervisorDbSize != null &&
                        ` (${formatFileSize(data.supervisorDbSize)})`}
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td fw={600}>Hub DB Path</Table.Td>
                    <Table.Td>
                      {data.hubDbPath}
                      {data.hubDbSize != null &&
                        ` (${formatFileSize(data.hubDbSize)})`}
                    </Table.Td>
                  </Table.Tr>
                  {data.hubAccessKey && (
                    <Table.Tr>
                      <Table.Td fw={600}>
                        <Group gap={4}>
                          Hub Access Key
                          <Tooltip
                            label="Set as HUB_ACCESS_KEY when installing NAISYS on other machines to connect to this hub"
                            multiline
                            w={250}
                          >
                            <IconInfoCircle
                              size="1rem"
                              style={{ cursor: "pointer" }}
                            />
                          </Tooltip>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <SecretField
                          value={data.hubAccessKey}
                          onRotate={
                            canRotateKey ? handleRotateAccessKey : undefined
                          }
                          rotating={rotating}
                        />
                      </Table.Td>
                    </Table.Tr>
                  )}
                  <Table.Tr>
                    <Table.Td fw={600}>Hub Connection</Table.Td>
                    <Table.Td>
                      <Badge
                        color={data.hubConnected ? "green" : "red"}
                        variant="filled"
                        size="sm"
                      >
                        {data.hubConnected ? "Connected" : "Disconnected"}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>

              {canExport && (
                <Button
                  onClick={handleExport}
                  loading={exporting}
                  style={{ alignSelf: "flex-start" }}
                >
                  Export Config
                </Button>
              )}
            </Stack>
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
