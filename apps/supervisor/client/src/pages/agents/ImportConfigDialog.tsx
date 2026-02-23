import { Alert, Button, Group, Modal, Stack, Textarea } from "@mantine/core";
import React, { useState } from "react";

import { importAgentConfig } from "../../lib/apiAgents";

interface ImportConfigDialogProps {
  agentId: number;
  opened: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const ImportConfigDialog: React.FC<ImportConfigDialogProps> = ({
  agentId,
  opened,
  onClose,
  onSuccess,
}) => {
  const [yamlText, setYamlText] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleImport = async () => {
    if (!yamlText.trim()) return;

    setIsImporting(true);
    setError(null);

    try {
      const result = await importAgentConfig(agentId, yamlText);

      if (!result.success) {
        setError(result.message || "Failed to import configuration");
        return;
      }

      onSuccess();
      handleClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to import configuration",
      );
    } finally {
      setIsImporting(false);
    }
  };

  const handleClose = () => {
    setYamlText("");
    setError(null);
    onClose();
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title="Import Config"
      centered
      size="lg"
    >
      <Stack gap="md">
        <Textarea
          label="YAML Configuration"
          placeholder="Paste agent configuration YAML here..."
          value={yamlText}
          onChange={(e) => setYamlText(e.currentTarget.value)}
          autosize
          minRows={10}
          maxRows={25}
          styles={{ input: { fontFamily: "monospace" } }}
          disabled={isImporting}
        />
        {error && (
          <Alert
            color="red"
            title="Error"
            withCloseButton
            onClose={() => setError(null)}
          >
            {error}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button
            variant="default"
            onClick={handleClose}
            disabled={isImporting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            loading={isImporting}
            disabled={!yamlText.trim()}
          >
            Import
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
