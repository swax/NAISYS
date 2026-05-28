import { ActionIcon, Stack, Text, Tooltip } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";

import { formatUserLabel } from "../lib/userLabel";

interface MetadataTooltipProps {
  createdBy?: string;
  createdByTitle?: string | null;
  createdAt: string;
  updatedBy?: string;
  updatedByTitle?: string | null;
  updatedAt: string;
}

export const MetadataTooltip: React.FC<MetadataTooltipProps> = ({
  createdBy,
  createdByTitle,
  createdAt,
  updatedBy,
  updatedByTitle,
  updatedAt,
}) => {
  const label = (
    <Stack gap={4}>
      <Text size="xs">
        Created
        {createdBy ? ` by ${formatUserLabel(createdBy, createdByTitle)}` : ""},{" "}
        {new Date(createdAt).toLocaleString()}
      </Text>
      <Text size="xs">
        Modified
        {updatedBy ? ` by ${formatUserLabel(updatedBy, updatedByTitle)}` : ""},{" "}
        {new Date(updatedAt).toLocaleString()}
      </Text>
    </Stack>
  );

  return (
    <Tooltip label={label} multiline withArrow>
      <ActionIcon variant="subtle" size="sm" color="gray">
        <IconInfoCircle size={16} />
      </ActionIcon>
    </Tooltip>
  );
};
