import {
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Textarea,
  TextInput,
} from "@mantine/core";
import React, { useState } from "react";

import { useAgentDataContext } from "../../contexts/AgentDataContext";
import {
  createAgent,
  exportAgentConfig,
  importAgentConfig,
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
  const [yamlConfig, setYamlConfig] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [loadingCopy, setLoadingCopy] = useState(false);

  const handleCopyFrom = async (agentIdStr: string | null) => {
    if (!agentIdStr) return;
    setLoadingCopy(true);
    try {
      const data = await exportAgentConfig(Number(agentIdStr));
      setYamlConfig(data.yaml);
    } catch (error) {
      console.error("Error exporting agent config:", error);
      alert(
        error instanceof Error
          ? error.message
          : "Failed to load agent config",
      );
    } finally {
      setLoadingCopy(false);
    }
  };

  const handleCreateAgent = async () => {
    if (!newAgentName.trim()) return;

    setIsCreating(true);
    try {
      const result = await createAgent(newAgentName.trim());

      if (!result.success) {
        throw new Error(result.message || "Failed to create agent");
      }

      // If YAML config was provided, import it
      if (yamlConfig.trim() && result.id) {
        const importResult = await importAgentConfig(result.id, yamlConfig);
        if (!importResult.success) {
          throw new Error(
            importResult.message || "Agent created but config import failed",
          );
        }
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
    setYamlConfig("");
    onClose();
  };

  const copyFromOptions = agents.map((a) => ({
    value: String(a.id),
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
        <Select
          label="Copy config from"
          placeholder="None"
          data={copyFromOptions}
          onChange={handleCopyFrom}
          clearable
          searchable
          disabled={isCreating || loadingCopy}
        />
        <Textarea
          label="YAML Configuration"
          placeholder="Leave empty to use default configuration"
          value={yamlConfig}
          onChange={(e) => setYamlConfig(e.currentTarget.value)}
          disabled={isCreating || loadingCopy}
          minRows={6}
          autosize
          spellCheck={false}
          styles={{ input: { fontFamily: "monospace" } }}
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
