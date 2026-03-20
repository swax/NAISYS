import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Container,
  Divider,
  Group,
  Loader,
  SegmentedControl,
  Stack,
  Tabs,
  Text,
  Tooltip,
} from "@mantine/core";
import type { OperationRun } from "@naisys-erp/shared";
import { OperationRunStatus } from "@naisys-erp/shared";
import { IconArrowBackUp } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { useOutletContext, useParams } from "react-router";

import { CompactMarkdown } from "@naisys/common-browser";
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
  const [laborActions, setLaborActions] = useState<LaborActions>({
    canClockIn: false,
    canClockOut: false,
  });
  const [laborActing, setLaborActing] = useState(false);

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

  const handleAction = async (
    action: "start" | "complete" | "skip" | "fail" | "reopen",
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
        {},
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
              OPERATION {opRun.seqNo}. {opRun.title}
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
            {hasAction(opRun._actions, "start") && (
              <Button
                size="xs"
                color="green"
                onClick={() => handleAction("start")}
              >
                Start
              </Button>
            )}
            {(() => {
              const completeAction = hasAction(opRun._actions, "complete");
              if (!completeAction) return null;
              const btn = (
                <Button
                  size="xs"
                  color="green"
                  disabled={completeAction.disabled}
                  onClick={() => handleAction("complete")}
                >
                  Complete
                </Button>
              );
              return completeAction.disabledReason ? (
                <Tooltip label={completeAction.disabledReason} multiline maw={350}>
                  {btn}
                </Tooltip>
              ) : (
                btn
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
    </Container>
  );
};
