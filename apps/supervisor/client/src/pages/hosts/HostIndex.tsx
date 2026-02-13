import { Stack, Text } from "@mantine/core";
import React from "react";

export const HostIndex: React.FC = () => {
  return (
    <Stack gap="md">
      <Text c="dimmed" ta="center">
        Select a host from the sidebar
      </Text>
    </Stack>
  );
};
