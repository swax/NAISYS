import { ActionIcon, Stack, Text, Tooltip } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";

interface MetadataTooltipProps {
  createdBy?: string;
  createdAt: string;
  updatedBy?: string;
  updatedAt: string;
}

export const MetadataTooltip: React.FC<MetadataTooltipProps> = ({
  createdBy,
  createdAt,
  updatedBy,
  updatedAt,
}) => {
  const label = (
    <Stack gap={4}>
      <Text size="xs">
        Created{createdBy ? ` by ${createdBy}` : ""},{" "}
        {new Date(createdAt).toLocaleString()}
      </Text>
      <Text size="xs">
        Modified{updatedBy ? ` by ${updatedBy}` : ""},{" "}
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
