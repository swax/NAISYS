import { Badge, Button, Card, Group, Stack, Text } from "@mantine/core";
import { hasAction, type HateoasAction } from "@naisys/common";
import { IconCpu, IconPhoto, IconPlus } from "@tabler/icons-react";
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ROUTER_BASENAME } from "../constants";
import type { LlmModelDetail, ImageModelDetail } from "../lib/apiClient";

interface ModelSidebarProps {
  llmModels: LlmModelDetail[];
  imageModels: ImageModelDetail[];
  actions: HateoasAction[] | undefined;
  isLoading: boolean;
}

export const ModelSidebar: React.FC<ModelSidebarProps> = ({
  llmModels,
  imageModels,
  actions,
  isLoading,
}) => {
  const navigate = useNavigate();
  const location = useLocation();

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
    navigate(getModelUrl(key));
  };

  if (isLoading) {
    return (
      <Text size="sm" c="dimmed">
        Loading models...
      </Text>
    );
  }

  return (
    <Stack gap="md">
      {/* LLM Models Section */}
      <div>
        <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb="xs">
          LLM Models
        </Text>
        <Stack gap="xs">
          {llmModels.map((model) => (
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
                <IconCpu size="1rem" style={{ flexShrink: 0 }} />
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
                    {model.apiType} &middot; {model.maxTokens.toLocaleString()}{" "}
                    tokens
                  </Text>
                </div>
              </Group>
            </Card>
          ))}
          {hasAction(actions, "save-llm") && (
            <Button
              variant="subtle"
              color="gray"
              size="compact-sm"
              leftSection={<IconPlus size="0.9rem" />}
              onClick={() => navigate("/models/new-llm")}
              fullWidth
            >
              Add LLM Model
            </Button>
          )}
        </Stack>
      </div>

      {/* Image Models Section */}
      <div>
        <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb="xs">
          Image Models
        </Text>
        <Stack gap="xs">
          {imageModels.map((model) => (
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
        </Stack>
      </div>
    </Stack>
  );
};
