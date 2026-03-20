import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Container,
  Divider,
  Group,
  Loader,
  Menu,
  Modal,
  Popover,
  SegmentedControl,
  Select,
  Stack,
  Tabs,
  Text,
  Textarea,
} from "@mantine/core";
import type { OperationRun, UserListResponse } from "@naisys-erp/shared";
import { OperationRunStatus } from "@naisys-erp/shared";
import { IconArrowBackUp, IconChevronDown, IconNote, IconX } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { useOutletContext, useParams } from "react-router";

import { ActionButton, CompactMarkdown } from "@naisys/common-browser";
import { MetadataTooltip } from "../../../components/MetadataTooltip";
import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";
import { hasAction } from "../../../lib/hateoas";
import { DependencyList } from "../revs/DependencyList";
import { CommentList } from "./CommentList";
import type { LaborActions } from "./LaborTicketList";
import { LaborTicketList } from "./LaborTicketList";
import classes from "./OperationRunDetail.module.css";
import type { OrderRunOutletContext } from "./OrderRunDetail";
import { StepRunList } from "./StepRunList";

const STATUS_COLORS: Record<string, string> = {
  blocked: "orange",
  pending: "gray",
  in_progress: "yellow",
  completed: "green",
  skipped: "gray",
  failed: "red",
};

export const OperationRunDetail: React.FC = () => {
  const { orderKey, runNo, seqNo } = useParams<{
    orderKey: string;
    runNo: string;
    seqNo: string;
  }>();
  const { onOperationUpdate, orderRun, refreshOrderRun } =
    useOutletContext<OrderRunOutletContext>();
  const [opRun, setOpRun] = useState<OperationRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState<string | null>("description");
  const [bottomView, setBottomView] = useState("steps");
  const [stepCount, setStepCount] = useState<number | null>(null);
  const [commentCount, setCommentCount] = useState<number | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [users, setUsers] = useState<{ value: string; label: string }[]>([]);
  const [laborActions, setLaborActions] = useState<LaborActions>({
    canClockIn: false,
    canClockOut: false,
  });
  const [laborActing, setLaborActing] = useState(false);
  const [completeNoteOpen, setCompleteNoteOpen] = useState(false);
  const [completeNoteText, setCompleteNoteText] = useState("");
  const [submittingNote, setSubmittingNote] = useState(false);

  const fetchOpRun = useCallback(async () => {
    if (!orderKey || !runNo || !seqNo) return;
    setLoading(true);
    try {
      const result = await api.get<OperationRun>(
        apiEndpoints.operationRun(orderKey, runNo, seqNo),
      );
      setOpRun(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [orderKey, runNo, seqNo]);

  useEffect(() => {
    void fetchOpRun();
  }, [fetchOpRun]);

  const fetchUsers = async () => {
    try {
      const result = await api.get<UserListResponse>(
        apiEndpoints.users + "?pageSize=100",
      );
      setUsers(
        result.items.map((u) => ({
          value: String(u.id),
          label: u.username,
        })),
      );
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const handleAssign = async (userId: number | null) => {
    if (!orderKey || !runNo || !seqNo) return;
    try {
      const updated = await api.put<OperationRun>(
        apiEndpoints.operationRun(orderKey, runNo, seqNo),
        { assignedToId: userId },
      );
      setOpRun(updated);
      setAssignOpen(false);
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const handleAction = async (
    action: "start" | "complete" | "skip" | "fail" | "reopen",
    body: Record<string, unknown> = {},
  ) => {
    if (!orderKey || !runNo || !seqNo) return;
    const endpointMap = {
      start: apiEndpoints.operationRunStart,
      complete: apiEndpoints.operationRunComplete,
      skip: apiEndpoints.operationRunSkip,
      fail: apiEndpoints.operationRunFail,
      reopen: apiEndpoints.operationRunReopen,
    };
    try {
      const updated = await api.post<OperationRun>(
        endpointMap[action](orderKey, runNo, seqNo),
        body,
      );
      setOpRun(updated);
      setRefreshKey((k) => k + 1);
      onOperationUpdate();
      refreshOrderRun();
    } catch (err) {
      showErrorNotification(err);
    }
  };

  const handleClockIn = async () => {
    if (!orderKey || !runNo || !seqNo) return;
    setLaborActing(true);
    try {
      await api.post(
        apiEndpoints.laborTicketClockIn(orderKey, runNo, seqNo),
        {},
      );
      setRefreshKey((k) => k + 1);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLaborActing(false);
    }
  };

  const handleClockOut = async () => {
    if (!orderKey || !runNo || !seqNo) return;
    setLaborActing(true);
    try {
      await api.post(
        apiEndpoints.laborTicketClockOut(orderKey, runNo, seqNo),
        {},
      );
      setRefreshKey((k) => k + 1);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLaborActing(false);
    }
  };

  const handleCompleteWithNote = async () => {
    setSubmittingNote(true);
    try {
      await handleAction("complete", {
        completionNote: completeNoteText.trim() || undefined,
      });
      setCompleteNoteOpen(false);
      setCompleteNoteText("");
    } finally {
      setSubmittingNote(false);
    }
  };

  if (loading) {
    return (
      <Stack align="center" py="xl">
        <Loader />
      </Stack>
    );
  }

  if (!opRun) {
    return (
      <Stack p="md">
        <Text>Operation run not found.</Text>
      </Stack>
    );
  }

  return (
    <Container size="md" py="xl" w="100%">
      <Stack gap="md">
        <Group justify="space-between">
          <Group gap="xs">
            <Text fw={600}>
              OPERATION {opRun.seqNo}: {opRun.title}
            </Text>
            <MetadataTooltip
              createdBy={opRun.createdBy}
              createdAt={opRun.createdAt}
              updatedBy={opRun.updatedBy}
              updatedAt={opRun.updatedAt}
            />
            <Badge
              color={STATUS_COLORS[opRun.status] ?? "gray"}
              variant="light"
              size="sm"
            >
              {opRun.status}
            </Badge>
            {opRun.assignedTo ? (
              <Group gap={4}>
                <Text size="sm" c="dimmed">
                  assigned to {opRun.assignedTo}
                </Text>
                {hasAction(opRun._actions, "assign") && (
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    color="gray"
                    onClick={() => void handleAssign(null)}
                    title="Unassign"
                  >
                    <IconX size={12} />
                  </ActionIcon>
                )}
              </Group>
            ) : (
              hasAction(opRun._actions, "assign") && (
                <Popover
                  opened={assignOpen}
                  onChange={setAssignOpen}
                  position="bottom"
                  withArrow
                >
                  <Popover.Target>
                    <Text
                      size="sm"
                      c="blue"
                      style={{ cursor: "pointer" }}
                      onClick={() => {
                        if (users.length === 0) void fetchUsers();
                        setAssignOpen(true);
                      }}
                    >
                      assign
                    </Text>
                  </Popover.Target>
                  <Popover.Dropdown>
                    <Select
                      placeholder="Select user..."
                      data={users}
                      searchable
                      size="xs"
                      w={200}
                      onChange={(val) => {
                        if (val) void handleAssign(Number(val));
                      }}
                    />
                  </Popover.Dropdown>
                </Popover>
              )
            )}
          </Group>
          <Group gap="xs">
            {(laborActions.canClockIn || laborActions.canClockOut) && (
              <>
                {laborActions.canClockIn && (
                  <Button
                    size="xs"
                    color="green"
                    variant="outline"
                    loading={laborActing}
                    onClick={() => void handleClockIn()}
                  >
                    Clock In
                  </Button>
                )}
                {laborActions.canClockOut && (
                  <Button
                    size="xs"
                    color="orange"
                    variant="outline"
                    loading={laborActing}
                    onClick={() => void handleClockOut()}
                  >
                    Clock Out
                  </Button>
                )}
                <Divider orientation="vertical" />
              </>
            )}
            <ActionButton
              actions={opRun._actions}
              rel="start"
              size="xs"
              color="green"
              onClick={() => handleAction("start")}
            >
              Start
            </ActionButton>
            {hasAction(opRun._actions, "complete", { includeDisabled: true }) &&
              (() => {
                const completeAction = hasAction(opRun._actions, "complete", { includeDisabled: true })!;
                return (
                  <Group gap={0}>
                    <Button
                      size="xs"
                      color="green"
                      disabled={completeAction.disabled}
                      onClick={() => handleAction("complete")}
                      style={{
                        borderTopRightRadius: 0,
                        borderBottomRightRadius: 0,
                      }}
                    >
                      Complete
                    </Button>
                    <Menu position="bottom-end" withinPortal>
                      <Menu.Target>
                        <Button
                          size="xs"
                          color="green"
                          px={6}
                          disabled={completeAction.disabled}
                          style={{
                            borderTopLeftRadius: 0,
                            borderBottomLeftRadius: 0,
                            borderLeft: "1px solid rgba(255,255,255,0.3)",
                          }}
                        >
                          <IconChevronDown size={14} />
                        </Button>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item
                          leftSection={<IconNote size={14} />}
                          onClick={() => {
                            setCompleteNoteOpen(true);
                            setCompleteNoteText("");
                          }}
                        >
                          Complete with note
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </Group>
                );
              })()}
            {hasAction(opRun._actions, "reopen") &&
              (() => {
                const labelMap: Record<
                  string,
                  { label: string; color: string }
                > = {
                  [OperationRunStatus.completed]: {
                    label: "Completed",
                    color: "green",
                  },
                  [OperationRunStatus.skipped]: {
                    label: "Skipped",
                    color: "gray",
                  },
                  [OperationRunStatus.failed]: {
                    label: "Failed",
                    color: "red",
                  },
                };
                const { label, color } = labelMap[opRun.status] ?? {
                  label: opRun.status,
                  color: "gray",
                };
                return (
                  <Group gap="xs" align="center">
                    <Text size="xs" c={color}>
                      {label} by {opRun.updatedBy} on{" "}
                      {new Date(opRun.updatedAt).toLocaleString()}
                      {opRun.cost ? ` for $${opRun.cost.toFixed(2)}` : ""}
                    </Text>
                    <ActionIcon
                      size="xs"
                      variant="subtle"
                      color="gray"
                      onClick={() => handleAction("reopen")}
                      title={`Undo ${label.toLowerCase()}`}
                    >
                      <IconArrowBackUp size={14} />
                    </ActionIcon>
                  </Group>
                );
              })()}
            {hasAction(opRun._actions, "skip") && (
              <Button
                size="xs"
                color="gray"
                variant="outline"
                onClick={() => handleAction("skip")}
              >
                Skip
              </Button>
            )}
            {hasAction(opRun._actions, "fail") && (
              <Button
                size="xs"
                color="red"
                variant="outline"
                onClick={() => handleAction("fail")}
              >
                Fail
              </Button>
            )}
          </Group>
        </Group>

        <Tabs value={activeTab} onChange={setActiveTab}>
          <Tabs.List>
            <Tabs.Tab value="description">Description</Tabs.Tab>
            <Tabs.Tab value="dependencies">Dependencies</Tabs.Tab>
            <Tabs.Tab value="labor">Labor Tickets</Tabs.Tab>
          </Tabs.List>

          <div className={classes.panelGrid}>
            <Tabs.Panel
              value="description"
              pt="sm"
              keepMounted
              data-active={activeTab === "description" || undefined}
            >
              <Card withBorder p="lg">
                <Stack gap="sm">
                  {opRun.description && (
                    <CompactMarkdown>{opRun.description}</CompactMarkdown>
                  )}
                  {opRun.completionNote && (
                    <Text size="xs" c="dimmed" fs="italic">
                      Completion Note: {opRun.completionNote}
                    </Text>
                  )}
                </Stack>
              </Card>
            </Tabs.Panel>

            <Tabs.Panel
              value="dependencies"
              pt="sm"
              keepMounted
              data-active={activeTab === "dependencies" || undefined}
            >
              <DependencyList
                orderKey={orderKey!}
                revNo={String(orderRun.revNo)}
                opSeqNo={seqNo!}
                showTitle={false}
              />
            </Tabs.Panel>

            <Tabs.Panel
              value="labor"
              pt="sm"
              keepMounted
              data-active={activeTab === "labor" || undefined}
            >
              <LaborTicketList
                orderKey={orderKey!}
                runNo={runNo!}
                seqNo={seqNo!}
                refreshKey={refreshKey}
                showTitle={false}
                onActionsChange={setLaborActions}
              />
            </Tabs.Panel>

          </div>
        </Tabs>

        <SegmentedControl
          value={bottomView}
          onChange={setBottomView}
          data={[
            {
              value: "steps",
              label: `Steps${stepCount ? ` (${stepCount})` : ""}`,
            },
            {
              value: "comments",
              label: `Comments${commentCount ? ` (${commentCount})` : ""}`,
            },
          ]}
        />

        <div style={{ display: bottomView === "steps" ? undefined : "none" }}>
          <StepRunList
            orderKey={orderKey!}
            runNo={runNo!}
            seqNo={seqNo!}
            refreshKey={refreshKey}
            onStepUpdate={fetchOpRun}
            onCountChange={setStepCount}
          />
        </div>
        <div style={{ display: bottomView === "comments" ? undefined : "none" }}>
          <CommentList
            orderKey={orderKey!}
            runNo={runNo!}
            seqNo={seqNo!}
            refreshKey={refreshKey}
            onCountChange={setCommentCount}
          />
        </div>
      </Stack>

      <Modal
        opened={completeNoteOpen}
        onClose={() => setCompleteNoteOpen(false)}
        title="Complete with Note"
        size="sm"
      >
        <Stack gap="md">
          <Textarea
            label="Completion note"
            placeholder="Enter a note..."
            value={completeNoteText}
            onChange={(e) => setCompleteNoteText(e.currentTarget.value)}
            autosize
            minRows={3}
            maxRows={6}
            data-autofocus
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setCompleteNoteOpen(false)}>
              Cancel
            </Button>
            <Button
              color="green"
              onClick={() => void handleCompleteWithNote()}
              loading={submittingNote}
            >
              Complete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
};
