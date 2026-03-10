import { ActionIcon, Code, Group, Text, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconCopy,
  IconEye,
  IconEyeOff,
  IconRefresh,
} from "@tabler/icons-react";
import { useState } from "react";

interface SecretFieldProps {
  value: string | null;
  onRotate?: () => void;
  rotating?: boolean;
}

export const SecretField: React.FC<SecretFieldProps> = ({
  value,
  onRotate,
  rotating,
}) => {
  const [visible, setVisible] = useState(false);

  return (
    <Group gap="xs" align="center">
      {value ? (
        <>
          <Code>{visible ? value : "••••••••••••••••"}</Code>
          <Tooltip label={visible ? "Hide" : "Show"}>
            <ActionIcon
              variant="subtle"
              size="sm"
              onClick={() => setVisible((v) => !v)}
            >
              {visible ? <IconEyeOff size={14} /> : <IconEye size={14} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Copy to clipboard">
            <ActionIcon
              variant="subtle"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(value);
                notifications.show({
                  title: "Copied",
                  message: "Copied to clipboard",
                  color: "green",
                });
              }}
            >
              <IconCopy size={14} />
            </ActionIcon>
          </Tooltip>
        </>
      ) : (
        <Text c="dimmed" size="sm">
          Not set
        </Text>
      )}
      {onRotate && (
        <Tooltip label={value ? "Rotate key" : "Generate API key"}>
          <ActionIcon
            variant="subtle"
            size="sm"
            loading={rotating}
            onClick={onRotate}
          >
            <IconRefresh size={14} />
          </ActionIcon>
        </Tooltip>
      )}
    </Group>
  );
};
