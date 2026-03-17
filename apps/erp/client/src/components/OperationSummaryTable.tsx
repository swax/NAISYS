import { Badge, Card, Group, Loader, Stack, Table, Text } from "@mantine/core";
import type { OperationPredecessor } from "@naisys-erp/shared";
import { Link } from "react-router";

export interface OperationSummaryItem {
  id: number;
  seqNo: number;
  title: string;
  stepCount?: number;
  predecessors?: OperationPredecessor[];
}

interface OperationSummaryTableProps {
  items: OperationSummaryItem[] | null;
  loading: boolean;
  linkBuilder: (seqNo: number) => string;
}

export const OperationSummaryTable: React.FC<OperationSummaryTableProps> = ({
  items,
  loading,
  linkBuilder,
}) => {
  return (
    <>
      <Text fw={600}>OPERATIONS</Text>
      <Card withBorder p="lg">
        {loading ? (
          <Stack align="center" py="sm">
            <Loader size="sm" />
          </Stack>
        ) : !items || items.length === 0 ? (
          <Text c="dimmed" size="sm">
            No operations defined.
          </Text>
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Seq</Table.Th>
                <Table.Th>Title</Table.Th>
                <Table.Th>Prerequisites</Table.Th>
                <Table.Th>Steps</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((op) => (
                <Table.Tr key={op.id}>
                  <Table.Td>{op.seqNo}</Table.Td>
                  <Table.Td>
                    <Text
                      component={Link}
                      to={linkBuilder(op.seqNo)}
                      size="sm"
                      c="blue"
                      style={{ textDecoration: "none" }}
                    >
                      {op.title}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {op.predecessors && op.predecessors.length > 0 ? (
                      <Group gap={4}>
                        {op.predecessors.map((p) => (
                          <Badge key={p.seqNo} variant="light" size="sm">
                            {p.seqNo}. {p.title}
                          </Badge>
                        ))}
                      </Group>
                    ) : (
                      <Text c="dimmed" size="sm">
                        None
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>{op.stepCount ?? 0}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>
    </>
  );
};
