import { Stack, Text } from "@mantine/core";
import React from "react";

export const ModelIndex: React.FC = () => {
  return (
    <Stack gap="md">
      <Text c="dimmed" ta="center">
        Select a model from the sidebar
      </Text>
    </Stack>
  );
};
