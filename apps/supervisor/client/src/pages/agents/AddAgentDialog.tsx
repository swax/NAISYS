import { Button, Group, Modal, Select, Stack, TextInput } from "@mantine/core";
import React, { useState } from "react";

import { useAgentDataContext } from "../../contexts/AgentDataContext";
import {
  createAgent,
  getAgentConfig,
  updateAgentConfig,
} from "../../lib/apiAgents";

interface AddAgentDialogProps {
  opened: boolean;
  onClose: () => void;
}

export const AddAgentDialog: React.FC<AddAgentDialogProps> = ({
  opened,
  onClose,
}) => {
  const { agents } = useAgentDataContext();
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentTitle, setNewAgentTitle] = useState("");
  const [copyFromAgent, setCopyFromAgent] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateAgent = async () => {
    const name = newAgentName.trim();
    const title = newAgentTitle.trim();
    if (!name) return;

    setIsCreating(true);
    try {
      // Fetch source config first so creation is aborted if the copy fails.
      const sourceConfig = copyFromAgent
        ? (await getAgentConfig(copyFromAgent)).config
        : null;

      const result = await createAgent(name, title || undefined);
      if (!result.success) {
        throw new Error(result.message || "Failed to create agent");
      }

      if (sourceConfig && result.name) {
        const merged = {
          ...sourceConfig,
          username: result.name,
          title: title || sourceConfig.title,
        };
        const updateResult = await updateAgentConfig(result.name, merged);
        if (!updateResult.success) {
          throw new Error(
            updateResult.message || "Agent created but config copy failed",
          );
        }
      }

      handleClose();
    } catch (error) {
      console.error("Error creating agent:", error);
      alert(error instanceof Error ? error.message : "Failed to create agent");
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    setNewAgentName("");
    setNewAgentTitle("");
    setCopyFromAgent(null);
    onClose();
  };

  const copyFromOptions = agents.map((a) => ({
    value: a.name,
    label: a.name,
  }));

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title="Create New Agent"
      centered
      size="lg"
    >
      <Stack gap="md">
        <TextInput
          label="Agent Name"
          placeholder="Enter agent name"
          value={newAgentName}
          onChange={(e) => setNewAgentName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newAgentName.trim()) {
              void handleCreateAgent();
            }
          }}
          disabled={isCreating}
        />
        <TextInput
          label="Title"
          placeholder="Assistant"
          value={newAgentTitle}
          onChange={(e) => setNewAgentTitle(e.currentTarget.value)}
          disabled={isCreating}
        />
        <Select
          label="Copy config from"
          placeholder="None"
          data={copyFromOptions}
          value={copyFromAgent}
          onChange={setCopyFromAgent}
          clearable
          searchable
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
