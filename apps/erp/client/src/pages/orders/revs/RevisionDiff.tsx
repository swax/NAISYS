import {
  Accordion,
  Badge,
  Button,
  Card,
  Container,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import type {
  DependencyDiff,
  FieldDiff,
  OperationDiff,
  PropertyChange,
  RevisionDiffResponse,
  StepDiff,
} from "@naisys/erp-shared";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";

const STATUS_COLORS: Record<string, string> = {
  added: "green",
  removed: "red",
  modified: "yellow",
  unchanged: "gray",
};

const PropertyChanges: React.FC<{ changes: PropertyChange[] }> = ({
  changes,
}) => (
  <Table withTableBorder withColumnBorders fz="sm">
    <Table.Thead>
      <Table.Tr>
        <Table.Th>Property</Table.Th>
        <Table.Th>From</Table.Th>
        <Table.Th>To</Table.Th>
      </Table.Tr>
    </Table.Thead>
    <Table.Tbody>
      {changes.map((c) => (
        <Table.Tr key={c.field}>
          <Table.Td fw={600}>{c.field}</Table.Td>
          <Table.Td c="red">{String(c.from ?? "—")}</Table.Td>
          <Table.Td c="green">{String(c.to ?? "—")}</Table.Td>
        </Table.Tr>
      ))}
    </Table.Tbody>
  </Table>
);

const FieldDiffSection: React.FC<{ fields: FieldDiff[] }> = ({ fields }) => {
  const changed = fields.filter((f) => f.status !== "unchanged");
  if (changed.length === 0) return null;

  return (
    <Stack gap="xs" ml="md">
      <Text fz="sm" fw={600}>
        Fields
      </Text>
      {changed.map((f) => (
        <Group key={f.seqNo} gap="xs">
          <Badge size="xs" color={STATUS_COLORS[f.status]}>
            {f.status}
          </Badge>
          <Text fz="sm">
            #{f.seqNo} {f.label}
          </Text>
          {f.changes && f.changes.length > 0 && (
            <Text fz="xs" c="dimmed">
              ({f.changes.map((c) => c.field).join(", ")})
            </Text>
          )}
        </Group>
      ))}
    </Stack>
  );
};

const StepDiffSection: React.FC<{ steps: StepDiff[] }> = ({ steps }) => {
  const changed = steps.filter((s) => s.status !== "unchanged");
  if (changed.length === 0) return null;

  return (
    <Stack gap="xs" ml="md">
      <Text fz="sm" fw={600}>
        Steps
      </Text>
      {changed.map((s) => (
        <Card key={s.seqNo} withBorder p="xs">
          <Group gap="xs" mb={s.changes || s.fields ? "xs" : 0}>
            <Badge size="xs" color={STATUS_COLORS[s.status]}>
              {s.status}
            </Badge>
            <Text fz="sm">
              Step #{s.seqNo} {s.title || "(untitled)"}
            </Text>
          </Group>
          {s.changes && s.changes.length > 0 && (
            <PropertyChanges changes={s.changes} />
          )}
          {s.fields && <FieldDiffSection fields={s.fields} />}
        </Card>
      ))}
    </Stack>
  );
};

const DependencyDiffSection: React.FC<{ deps: DependencyDiff[] }> = ({
  deps,
}) => {
  const changed = deps.filter((d) => d.status !== "unchanged");
  if (changed.length === 0) return null;

  return (
    <Stack gap="xs" ml="md">
      <Text fz="sm" fw={600}>
        Dependencies
      </Text>
      {changed.map((d) => (
        <Group key={d.predecessorSeqNo} gap="xs">
          <Badge size="xs" color={STATUS_COLORS[d.status]}>
            {d.status}
          </Badge>
          <Text fz="sm">
            Predecessor: #{d.predecessorSeqNo} {d.predecessorTitle}
          </Text>
        </Group>
      ))}
    </Stack>
  );
};

const OperationDiffItem: React.FC<{ op: OperationDiff }> = ({ op }) => (
  <Accordion.Item value={`op-${op.seqNo}`}>
    <Accordion.Control>
      <Group gap="sm">
        <Badge color={STATUS_COLORS[op.status]}>{op.status}</Badge>
        <Text fw={600}>
          OP {op.seqNo}: {op.title}
        </Text>
      </Group>
    </Accordion.Control>
    <Accordion.Panel>
      <Stack gap="sm">
        {op.changes && op.changes.length > 0 && (
          <PropertyChanges changes={op.changes} />
        )}
        {op.steps && <StepDiffSection steps={op.steps} />}
        {op.dependencies && <DependencyDiffSection deps={op.dependencies} />}
        {!op.changes && !op.steps && !op.dependencies && (
          <Text fz="sm" c="dimmed">
            {op.status === "added"
              ? "New operation"
              : op.status === "removed"
                ? "Operation removed"
                : "No changes"}
          </Text>
        )}
      </Stack>
    </Accordion.Panel>
  </Accordion.Item>
);

export const RevisionDiff: React.FC = () => {
  const { orderKey } = useParams<{ orderKey: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const fromRevNo = searchParams.get("from");
  const toRevNo = searchParams.get("to");

  const [diff, setDiff] = useState<RevisionDiffResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDiff = useCallback(async () => {
    if (!orderKey || !fromRevNo || !toRevNo) return;
    setLoading(true);
    try {
      const result = await api.get<RevisionDiffResponse>(
        apiEndpoints.orderRevDiff(orderKey, fromRevNo, toRevNo),
      );
      setDiff(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [orderKey, fromRevNo, toRevNo]);

  useEffect(() => {
    void fetchDiff();
  }, [fetchDiff]);

  const changedOps = diff
    ? diff.operations.filter((op) => op.status !== "unchanged")
    : [];
  const unchangedCount = diff ? diff.operations.length - changedOps.length : 0;

  return (
    <Container size="md" py="xl">
      <Group justify="space-between" mb="lg">
        <Title order={2}>
          Compare Revisions: Rev {fromRevNo} → Rev {toRevNo}
        </Title>
        <Button
          variant="subtle"
          onClick={() => navigate(`/orders/${orderKey}`)}
        >
          Back to Order
        </Button>
      </Group>

      {loading ? (
        <Stack align="center" py="xl">
          <Loader />
        </Stack>
      ) : !diff ? (
        <Text>Could not load diff.</Text>
      ) : (
        <Stack gap="md">
          {diff.revisionChanges.length > 0 && (
            <Card withBorder p="lg">
              <Title order={4} mb="sm">
                Revision Properties
              </Title>
              <PropertyChanges changes={diff.revisionChanges} />
            </Card>
          )}

          <Card withBorder p="lg">
            <Group justify="space-between" mb="sm">
              <Title order={4}>Operations</Title>
              {unchangedCount > 0 && (
                <Text fz="sm" c="dimmed">
                  {unchangedCount} unchanged operation
                  {unchangedCount !== 1 ? "s" : ""} hidden
                </Text>
              )}
            </Group>

            {changedOps.length === 0 && diff.revisionChanges.length === 0 ? (
              <Text c="dimmed">No differences found between revisions.</Text>
            ) : changedOps.length === 0 ? (
              <Text c="dimmed">No operation changes.</Text>
            ) : (
              <Accordion variant="separated" multiple>
                {changedOps.map((op) => (
                  <OperationDiffItem key={op.seqNo} op={op} />
                ))}
              </Accordion>
            )}
          </Card>
        </Stack>
      )}
    </Container>
  );
};
