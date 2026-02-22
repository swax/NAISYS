import {
  ActionIcon,
  Button,
  CloseButton,
  Group,
  Modal,
  Select,
  Stack,
} from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import React, { useState } from "react";
import type { Agent } from "../../lib/apiClient";

interface NewChatDialogProps {
  opened: boolean;
  onClose: () => void;
  onNewChat: (toIds: number[]) => void;
  agents: Agent[];
  currentAgentId: number;
}

export const NewChatDialog: React.FC<NewChatDialogProps> = ({
  opened,
  onClose,
  onNewChat,
  agents,
  currentAgentId,
}) => {
  const [recipientSlots, setRecipientSlots] = useState<(string | null)[]>([
    null,
  ]);

  const allRecipientOptions = agents
    .filter((a) => a.id !== currentAgentId)
    .map((a) => ({
      value: String(a.id),
      label: a.title ? `${a.name} (${a.title})` : a.name,
    }));

  const getAvailableOptions = (slotIndex: number) => {
    const selectedInOtherSlots = recipientSlots
      .filter((_, i) => i !== slotIndex)
      .filter(Boolean) as string[];
    return allRecipientOptions.filter(
      (o) => !selectedInOtherSlots.includes(o.value),
    );
  };

  const updateSlot = (index: number, value: string | null) => {
    setRecipientSlots((prev) =>
      prev.map((v, i) => (i === index ? value : v)),
    );
  };

  const removeSlot = (index: number) => {
    setRecipientSlots((prev) => prev.filter((_, i) => i !== index));
  };

  const addSlot = () => {
    setRecipientSlots((prev) => [...prev, null]);
  };

  const selectedRecipients = recipientSlots.filter(Boolean) as string[];
  const canAddMore =
    selectedRecipients.length < allRecipientOptions.length &&
    recipientSlots.every(Boolean);

  const handleClose = () => {
    setRecipientSlots([null]);
    onClose();
  };

  const handleStartChat = () => {
    if (selectedRecipients.length > 0) {
      onNewChat(selectedRecipients.map(Number));
      setRecipientSlots([null]);
    }
  };

  return (
    <Modal opened={opened} onClose={handleClose} title="New Chat" size="sm">
      <Stack gap="md">
        {recipientSlots.map((slot, index) => (
          <Group key={index} gap="xs" align="flex-end">
            <Select
              label={index === 0 ? "Chat with" : undefined}
              placeholder="Select an agent"
              data={getAvailableOptions(index)}
              value={slot}
              onChange={(value) => updateSlot(index, value)}
              searchable
              style={{ flex: 1 }}
            />
            {recipientSlots.length > 1 && (
              <CloseButton onClick={() => removeSlot(index)} />
            )}
          </Group>
        ))}
        {canAddMore && (
          <ActionIcon variant="light" color="gray" onClick={addSlot}>
            <IconPlus size={16} />
          </ActionIcon>
        )}
        <Group justify="flex-end">
          <Button
            onClick={handleStartChat}
            disabled={selectedRecipients.length === 0}
          >
            Start Chat
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
