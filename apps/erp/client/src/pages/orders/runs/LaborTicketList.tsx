import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import type { LaborTicketListResponse } from "@naisys-erp/shared";
import { IconTrash } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";
import { hasAction } from "../../../lib/hateoas";

interface Props {
  orderKey: string;
  runNo: string;
  seqNo: string;
  refreshKey?: number;
}

function formatDuration(clockIn: string, clockOut: string | null): string {
  const end = clockOut ? new Date(clockOut) : new Date();
  const ms = end.getTime() - new Date(clockIn).getTime();
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export const LaborTicketList: React.FC<Props> = ({
  orderKey,
  runNo,
  seqNo,
  refreshKey,
}) => {
  const [data, setData] = useState<LaborTicketListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [loadedSeqNo, setLoadedSeqNo] = useState(seqNo);

  if (seqNo !== loadedSeqNo) {
    setLoadedSeqNo(seqNo);
    setData(null);
    setLoading(true);
  }

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<LaborTicketListResponse>(
        apiEndpoints.laborTickets(orderKey, runNo, seqNo),
      );
      setData(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [orderKey, runNo, seqNo, refreshKey]);

  useEffect(() => {
    void fetchTickets();
  }, [fetchTickets]);

  const handleClockIn = async () => {
    setActing(true);
    try {
      await api.post(apiEndpoints.laborTicketClockIn(orderKey, runNo, seqNo), {});
      await fetchTickets();
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setActing(false);
    }
  };

  const handleClockOut = async () => {
    setActing(true);
    try {
      const result = await api.post<LaborTicketListResponse>(
        apiEndpoints.laborTicketClockOut(orderKey, runNo, seqNo),
        {},
      );
      setData(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setActing(false);
    }
  };

  const handleDelete = async (ticketId: number) => {
    try {
      await api.delete(
        apiEndpoints.laborTicket(orderKey, runNo, seqNo, ticketId),
      );
      await fetchTickets();
    } catch (err) {
      showErrorNotification(err);
    }
  };

  return (
    <>
      <Group justify="space-between" align="center">
        <Title order={5}>Labor Tickets</Title>
        <Group gap="xs">
          {data && hasAction(data._actions, "clock-in") && (
            <Button
              size="xs"
              color="green"
              loading={acting}
              onClick={() => void handleClockIn()}
            >
              Clock In
            </Button>
          )}
          {data && hasAction(data._actions, "clock-out") && (
            <Button
              size="xs"
              color="orange"
              loading={acting}
              onClick={() => void handleClockOut()}
            >
              Clock Out
            </Button>
          )}
        </Group>
      </Group>

      {loading ? (
        <Stack align="center" py="sm">
          <Loader size="sm" />
        </Stack>
      ) : (
        <>
          {data && data.items.length > 0 ? (
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>User</Table.Th>
                  <Table.Th>Run</Table.Th>
                  <Table.Th>Clock In</Table.Th>
                  <Table.Th>Clock Out</Table.Th>
                  <Table.Th>Duration</Table.Th>
                  <Table.Th>Cost</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.items.map((ticket) => (
                  <Table.Tr key={ticket.id}>
                    <Table.Td>{ticket.username}</Table.Td>
                    <Table.Td>
                      {ticket.runId != null ? (
                        <Anchor
                          size="sm"
                          href={`/supervisor/agents/${ticket.username}/runs/${ticket.runId}-1`}
                        >
                          {ticket.runId}
                        </Anchor>
                      ) : (
                        "—"
                      )}
                    </Table.Td>
                    <Table.Td>
                      {new Date(ticket.clockIn).toLocaleString()}
                    </Table.Td>
                    <Table.Td>
                      {ticket.clockOut ? (
                        new Date(ticket.clockOut).toLocaleString()
                      ) : (
                        <Badge color="green" size="sm" variant="light">
                          Open
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {formatDuration(ticket.clockIn, ticket.clockOut)}
                    </Table.Td>
                    <Table.Td>
                      {ticket.cost != null ? `$${ticket.cost.toFixed(2)}` : "—"}
                    </Table.Td>
                    <Table.Td>
                      {hasAction(ticket._actions, "delete") && (
                        <ActionIcon
                          size="xs"
                          variant="subtle"
                          color="red"
                          onClick={() => void handleDelete(ticket.id)}
                          title="Delete ticket"
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          ) : (
            <Text size="sm" c="dimmed">
              No labor tickets.
            </Text>
          )}
        </>
      )}
    </>
  );
};
