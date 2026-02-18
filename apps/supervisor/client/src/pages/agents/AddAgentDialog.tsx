import { Button, Group, Modal, Stack, TextInput } from "@mantine/core";
import React, { useState } from "react";
import { createAgent } from "../../lib/apiAgents";

interface AddAgentDialogProps {
  opened: boolean;
  onClose: () => void;
}

export const AddAgentDialog: React.FC<AddAgentDialogProps> = ({
  opened,
  onClose,
}) => {
  const [newAgentName, setNewAgentName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateAgent = async () => {
    if (!newAgentName.trim()) return;

    setIsCreating(true);
    try {
      const result = await createAgent(newAgentName.trim());

      if (!result.success) {
        throw new Error(result.message || "Failed to create agent");
      }

      // Close modal and reset form
      handleClose();

      // The AgentDataContext should pick up the new agent on next refresh
    } catch (error) {
      console.error("Error creating agent:", error);
      alert(error instanceof Error ? error.message : "Failed to create agent");
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    setNewAgentName("");
    onClose();
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title="Create New Agent"
      centered
    >
      <Stack gap="md">
        <TextInput
          label="Agent Name"
          placeholder="Enter agent name"
          value={newAgentName}
          onChange={(e) => setNewAgentName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newAgentName.trim()) {
              handleCreateAgent();
            }
          }}
          disabled={isCreating}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={handleClose} disabled={isCreating}>
            Cancel
          </Button>
          <Button
            onClick={handleCreateAgent}
            loading={isCreating}
            disabled={!newAgentName.trim()}
          >
            Create
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
