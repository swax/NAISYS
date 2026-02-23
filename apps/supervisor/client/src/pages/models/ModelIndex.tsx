import { Button, Group, Stack, Text } from "@mantine/core";
import { hasAction } from "@naisys/common";
import { IconPlus } from "@tabler/icons-react";
import React from "react";
import { useNavigate } from "react-router-dom";

import { useModelsContext } from "./ModelsLayout";

export const ModelIndex: React.FC = () => {
  const navigate = useNavigate();
  const { actions } = useModelsContext();

  return (
    <Stack gap="md">
      <Text c="dimmed" ta="center">
        Select a model from the sidebar
      </Text>
      {(hasAction(actions, "save-llm") || hasAction(actions, "save-image")) && (
        <Group justify="center" gap="sm">
          {hasAction(actions, "save-llm") && (
            <Button
              variant="light"
              leftSection={<IconPlus size={16} />}
              onClick={() => navigate("/models/new-llm")}
            >
              Create LLM Model
            </Button>
          )}
          {hasAction(actions, "save-image") && (
            <Button
              variant="light"
              leftSection={<IconPlus size={16} />}
              onClick={() => navigate("/models/new-image")}
            >
              Create Image Model
            </Button>
          )}
        </Group>
      )}
    </Stack>
  );
};
