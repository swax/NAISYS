import {
  Badge,
  Button,
  Container,
  Group,
  Loader,
  Stack,
  Table,
  Title,
  Tooltip,
} from "@mantine/core";
import { hasAction } from "@naisys/common";
import { IconInfoCircle } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

import { downloadExportConfig } from "../../lib/apiAdmin";
import type { AdminInfoResponse } from "../../lib/apiClient";
import { api, apiEndpoints } from "../../lib/apiClient";

export const AdminPage: React.FC = () => {
  const [data, setData] = useState<AdminInfoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

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

  const canExport = data ? !!hasAction(data._actions, "export-config") : false;

  return (
    <Container size="lg" py="xl">
      <Title order={2} mb="lg">
        Admin
      </Title>

      {loading ? (
        <Stack align="center" py="xl">
          <Loader />
        </Stack>
      ) : data ? (
        <Stack>
          <Table striped highlightOnHover>
            <Table.Tbody>
              <Table.Tr>
                <Table.Td fw={600}>Supervisor DB Path</Table.Td>
                <Table.Td>{data.supervisorDbPath}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td fw={600}>Hub DB Path</Table.Td>
                <Table.Td>{data.hubDbPath}</Table.Td>
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
                  <Table.Td>{data.hubAccessKey}</Table.Td>
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
      ) : null}
    </Container>
  );
};
