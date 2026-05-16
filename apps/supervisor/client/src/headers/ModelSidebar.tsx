import { Badge, Button, Card, Group, Stack, Text, Tooltip } from "@mantine/core";
import {
  builtInRealtimeModels,
  hasAction,
  type HateoasAction,
} from "@naisys/common";
import {
  IconBrain,
  IconCalculator,
  IconChartDots,
  IconCpu,
  IconDeviceDesktop,
  IconEye,
  IconFunction,
  IconHeadphones,
  IconPhoto,
  IconPlus,
  IconUser,
} from "@tabler/icons-react";
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { ApiTypeBadge } from "../components/ApiTypeBadge";
import { ROUTER_BASENAME } from "../constants";
import type { ImageModelDetail, LlmModelDetail } from "../lib/apiClient";
import { AddOpenRouterModelDialog } from "../pages/models/AddOpenRouterModelDialog";

interface ModelSidebarProps {
  llmModels: LlmModelDetail[];
  imageModels: ImageModelDetail[];
  actions: HateoasAction[] | undefined;
  isLoading: boolean;
  refreshModels: () => Promise<void>;
}

export const ModelSidebar: React.FC<ModelSidebarProps> = ({
  llmModels,
  imageModels,
  actions,
  isLoading,
  refreshModels,
}) => {
  const [openRouterDialogOpen, setOpenRouterDialogOpen] = React.useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const sortedLlmModels = React.useMemo(
    () => [...llmModels].sort((a, b) => a.label.localeCompare(b.label)),
    [llmModels],
  );

  const sortedImageModels = React.useMemo(
    () => [...imageModels].sort((a, b) => a.label.localeCompare(b.label)),
    [imageModels],
  );

  // Catalog lives in @naisys/common — no API fetch, no editing.
  const sortedRealtimeModels = React.useMemo(
    () =>
      [...builtInRealtimeModels].sort((a, b) => a.label.localeCompare(b.label)),
    [],
  );

  const isModelSelected = (key: string) => {
    const pathParts = location.pathname.split("/");
    // Path: /models/:key
    return pathParts[2] === key;
  };

  const getModelUrl = (key: string) => `/models/${encodeURIComponent(key)}`;

  const getModelAbsoluteUrl = (key: string) =>
    `${ROUTER_BASENAME}${getModelUrl(key)}`;

  const handleClick = (e: React.MouseEvent, key: string) => {
    if (e.button === 1 || e.ctrlKey || e.metaKey) {
      return;
    }
    e.preventDefault();
    void navigate(getModelUrl(key));
  };

  if (isLoading) {
    return (
      <Text size="sm" c="dimmed">
        Loading models...
      </Text>
    );
  }

  const isOverview = location.pathname === "/models";
  const isCalculator = location.pathname === "/models/calculator";

  return (
    <Stack gap="md">
      {/* Overview Link */}
      <Card
        padding="sm"
        radius="md"
        withBorder
        component="a"
        href={`${ROUTER_BASENAME}/models`}
        onClick={(e: React.MouseEvent) => {
          if (e.button === 1 || e.ctrlKey || e.metaKey) return;
          e.preventDefault();
          void navigate("/models");
        }}
        style={{
          cursor: "pointer",
          backgroundColor: isOverview
            ? "var(--mantine-color-blue-9)"
            : undefined,
          textDecoration: "none",
          color: "inherit",
          display: "block",
        }}
      >
        <Group gap="xs" align="center" wrap="nowrap">
          <IconChartDots size="1rem" style={{ flexShrink: 0 }} />
          <Text size="sm" fw={500}>
            Overview
          </Text>
        </Group>
      </Card>

      {/* Calculator Link */}
      <Card
        padding="sm"
        radius="md"
        withBorder
        component="a"
        href={`${ROUTER_BASENAME}/models/calculator`}
        onClick={(e: React.MouseEvent) => {
          if (e.button === 1 || e.ctrlKey || e.metaKey) return;
          e.preventDefault();
          void navigate("/models/calculator");
        }}
        style={{
          cursor: "pointer",
          backgroundColor: isCalculator
            ? "var(--mantine-color-blue-9)"
            : undefined,
          textDecoration: "none",
          color: "inherit",
          display: "block",
        }}
      >
        <Group gap="xs" align="center" wrap="nowrap">
          <IconCalculator size="1rem" style={{ flexShrink: 0 }} />
          <Text size="sm" fw={500}>
            Calculator
          </Text>
        </Group>
      </Card>

      {/* LLM Models Section */}
      <div>
        <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb="xs">
          LLM Models
        </Text>
        <Stack gap="xs">
          {hasAction(actions, "save-llm") && (
            <Button
              variant="subtle"
              color="gray"
              size="compact-sm"
              leftSection={<IconPlus size="0.9rem" />}
              onClick={() => navigate("/models/new-llm")}
              fullWidth
            >
              Add Model Manually
            </Button>
          )}
          <Button
            variant="subtle"
            color="gray"
            size="compact-sm"
            leftSection={<IconPlus size="0.9rem" />}
            onClick={() => setOpenRouterDialogOpen(true)}
            fullWidth
          >
            Add OpenRouter Model
          </Button>
          {sortedLlmModels.map((model) => (
            <Card
              key={model.key}
              padding="sm"
              radius="md"
              withBorder
              component="a"
              href={getModelAbsoluteUrl(model.key)}
              onClick={(e) => handleClick(e, model.key)}
              style={{
                cursor: "pointer",
                backgroundColor: isModelSelected(model.key)
                  ? "var(--mantine-color-blue-9)"
                  : undefined,
                textDecoration: "none",
                color: "inherit",
                display: "block",
              }}
            >
              <Group gap="xs" align="center" wrap="nowrap">
                {model.key === "none" ? (
                  <IconUser size="1rem" style={{ flexShrink: 0 }} />
                ) : (
                  <IconCpu size="1rem" style={{ flexShrink: 0 }} />
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Group gap={4} wrap="nowrap">
                    <Text size="sm" fw={500} truncate="end">
                      {model.label}
                    </Text>
                    {model.isCustom && (
                      <Badge
                        size="xs"
                        variant="light"
                        color="teal"
                        style={{ flexShrink: 0 }}
                      >
                        Custom
                      </Badge>
                    )}
                  </Group>
                  <Group gap={6} align="center" wrap="nowrap" mt={6}>
                    <ApiTypeBadge apiType={model.apiType} />
                    {model.supportsToolUse && (
                      <Tooltip label="Tool Use">
                        <IconFunction
                          size={14}
                          color="var(--mantine-color-dimmed)"
                          style={{ flexShrink: 0 }}
                        />
                      </Tooltip>
                    )}
                    {model.supportsVision && (
                      <Tooltip label="Vision">
                        <IconEye
                          size={14}
                          color="var(--mantine-color-dimmed)"
                          style={{ flexShrink: 0 }}
                        />
                      </Tooltip>
                    )}
                    {model.supportsHearing && (
                      <Tooltip label="Hearing">
                        <IconHeadphones
                          size={14}
                          color="var(--mantine-color-dimmed)"
                          style={{ flexShrink: 0 }}
                        />
                      </Tooltip>
                    )}
                    {model.supportsComputerUse && (
                      <Tooltip label="Computer Use">
                        <IconDeviceDesktop
                          size={14}
                          color="var(--mantine-color-dimmed)"
                          style={{ flexShrink: 0 }}
                        />
                      </Tooltip>
                    )}
                    {model.reasoningLevel &&
                      model.reasoningLevel !== "none" && (
                        <Tooltip label={`Reasoning: ${model.reasoningLevel}`}>
                          <IconBrain
                            size={14}
                            color="var(--mantine-color-dimmed)"
                            style={{ flexShrink: 0 }}
                          />
                        </Tooltip>
                      )}
                  </Group>
                </div>
              </Group>
            </Card>
          ))}
        </Stack>
      </div>

      <AddOpenRouterModelDialog
        opened={openRouterDialogOpen}
        onClose={() => setOpenRouterDialogOpen(false)}
        onAdded={refreshModels}
        canSave={!!hasAction(actions, "save-llm")}
      />

      {/* Image Models Section */}
      <div>
        <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb="xs">
          Image Models
        </Text>
        <Stack gap="xs">
          {hasAction(actions, "save-image") && (
            <Button
              variant="subtle"
              color="gray"
              size="compact-sm"
              leftSection={<IconPlus size="0.9rem" />}
              onClick={() => navigate("/models/new-image")}
              fullWidth
            >
              Add Image Model
            </Button>
          )}
          {sortedImageModels.map((model) => (
            <Card
              key={model.key}
              padding="sm"
              radius="md"
              withBorder
              component="a"
              href={getModelAbsoluteUrl(model.key)}
              onClick={(e) => handleClick(e, model.key)}
              style={{
                cursor: "pointer",
                backgroundColor: isModelSelected(model.key)
                  ? "var(--mantine-color-blue-9)"
                  : undefined,
                textDecoration: "none",
                color: "inherit",
                display: "block",
              }}
            >
              <Group gap="xs" align="center" wrap="nowrap">
                <IconPhoto size="1rem" style={{ flexShrink: 0 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Group gap={4} wrap="nowrap">
                    <Text size="sm" fw={500} truncate="end">
                      {model.label}
                    </Text>
                    {model.isCustom && (
                      <Badge
                        size="xs"
                        variant="light"
                        color="teal"
                        style={{ flexShrink: 0 }}
                      >
                        Custom
                      </Badge>
                    )}
                  </Group>
                  <Text size="xs" c="dimmed" truncate="end">
                    {model.size} &middot; ${model.cost}
                  </Text>
                </div>
              </Group>
            </Card>
          ))}
        </Stack>
      </div>

      {/* Realtime Models — read-only (ModelPage detects the key). */}
      <div>
        <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb="xs">
          Realtime Models
        </Text>
        <Stack gap="xs">
          {sortedRealtimeModels.map((model) => (
            <Card
              key={model.key}
              padding="sm"
              radius="md"
              withBorder
              component="a"
              href={getModelAbsoluteUrl(model.key)}
              onClick={(e) => handleClick(e, model.key)}
              style={{
                cursor: "pointer",
                backgroundColor: isModelSelected(model.key)
                  ? "var(--mantine-color-blue-9)"
                  : undefined,
                textDecoration: "none",
                color: "inherit",
                display: "block",
              }}
            >
              <Group gap="xs" align="center" wrap="nowrap">
                <IconHeadphones size="1rem" style={{ flexShrink: 0 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Text size="sm" fw={500} truncate="end">
                    {model.label}
                  </Text>
                  <Text size="xs" c="dimmed" truncate="end">
                    Audio ${model.pricingPerMTok.inputAudio}/$
                    {model.pricingPerMTok.outputAudio} per 1M
                  </Text>
                  <Group gap={6} align="center" wrap="nowrap" mt={6}>
                    {model.supportsVision && (
                      <Tooltip label="Vision">
                        <IconEye
                          size={14}
                          color="var(--mantine-color-dimmed)"
                          style={{ flexShrink: 0 }}
                        />
                      </Tooltip>
                    )}
                    {model.supportsReasoning && (
                      <Tooltip label="Reasoning">
                        <IconBrain
                          size={14}
                          color="var(--mantine-color-dimmed)"
                          style={{ flexShrink: 0 }}
                        />
                      </Tooltip>
                    )}
                  </Group>
                </div>
              </Group>
            </Card>
          ))}
        </Stack>
      </div>
    </Stack>
  );
};
