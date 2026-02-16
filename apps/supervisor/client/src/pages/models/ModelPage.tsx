import {
  Alert,
  Button,
  Group,
  Modal,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { hasAction } from "@naisys/common";
import { IconEdit, IconTrash } from "@tabler/icons-react";
import React, { useCallback, useEffect, useState } from "react";
import { useBlocker, useNavigate, useParams } from "react-router-dom";
import { LlmModelForm } from "../../components/LlmModelForm";
import { ImageModelForm } from "../../components/ImageModelForm";
import { saveLlmModel, saveImageModel, deleteModel } from "../../lib/apiModels";
import { useModelsContext } from "./ModelsLayout";

type ModelType = "llm" | "image";

export const ModelPage: React.FC = () => {
  const { key } = useParams<{ key: string }>();
  const { llmModels, imageModels, actions, refreshModels } = useModelsContext();
  const navigate = useNavigate();

  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Detect create mode
  const isNewLlm = key === "new-llm";
  const isNewImage = key === "new-image";
  const isNew = isNewLlm || isNewImage;

  // Start in editing mode for new models
  useEffect(() => {
    if (isNew) {
      setIsEditing(true);
    }
  }, [isNew]);

  // Reset editing state when key changes (navigating to a different model)
  useEffect(() => {
    if (!isNew) {
      setIsEditing(false);
      setSaveError(null);
    }
  }, [key, isNew]);

  // Block navigation while editing
  const blocker = useBlocker(isEditing && !isNew);

  useEffect(() => {
    if (blocker.state === "blocked") {
      if (window.confirm("You have unsaved changes. Leave this page?")) {
        blocker.proceed();
      } else {
        blocker.reset();
      }
    }
  }, [blocker]);

  const handleBeforeUnload = useCallback(
    (e: BeforeUnloadEvent) => {
      if (isEditing) {
        e.preventDefault();
      }
    },
    [isEditing],
  );

  useEffect(() => {
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [handleBeforeUnload]);

  // Find existing model
  const llm = !isNew ? llmModels.find((m) => m.key === key) : undefined;
  const img = !isNew ? imageModels.find((m) => m.key === key) : undefined;

  if (!isNew && !llm && !img) {
    return (
      <Stack gap="md">
        <Text c="dimmed" ta="center">
          Model not found
        </Text>
      </Stack>
    );
  }

  // Determine model type
  let modelType: ModelType;
  if (isNewLlm || llm) {
    modelType = "llm";
  } else {
    modelType = "image";
  }

  const isCustom = llm?.isCustom || img?.isCustom || false;

  const handleEdit = () => {
    setIsEditing(true);
    setSaveError(null);
  };

  const handleCancel = () => {
    if (isNew) {
      navigate("/models");
    } else {
      setIsEditing(false);
      setSaveError(null);
    }
  };

  const handleSave = async (model: Record<string, unknown>) => {
    setSaving(true);
    setSaveError(null);
    try {
      const result =
        modelType === "llm"
          ? await saveLlmModel(model)
          : await saveImageModel(model);

      if (result.success) {
        await refreshModels();
        if (isNew) {
          navigate(`/models/${encodeURIComponent(model.key as string)}`);
        } else {
          setIsEditing(false);
        }
      } else {
        setSaveError(result.message || "Failed to save model");
      }
    } catch (err) {
      console.error("Error saving model:", err);
      setSaveError("An error occurred while saving the model");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleteConfirmOpen(false);
    setSaving(true);
    setSaveError(null);
    try {
      const modelKey = (llm?.key || img?.key)!;
      const result = await deleteModel(modelType, modelKey);
      if (result.success) {
        await refreshModels();
        if (result.revertedToBuiltIn) {
          // Stay on the same page — model is now the built-in version
        } else {
          navigate("/models");
        }
      } else {
        setSaveError(result.message || "Failed to delete model");
      }
    } catch (err) {
      console.error("Error deleting model:", err);
      setSaveError("An error occurred while deleting the model");
    } finally {
      setSaving(false);
    }
  };

  // --- Create mode ---
  if (isNew) {
    return (
      <Stack gap="md">
        <Title order={2}>
          {isNewLlm ? "Create LLM Model" : "Create Image Model"}
        </Title>
        {saveError && (
          <Alert
            color="red"
            title="Error"
            onClose={() => setSaveError(null)}
            withCloseButton
          >
            {saveError}
          </Alert>
        )}
        {isNewLlm ? (
          <LlmModelForm
            isNew
            saving={saving}
            onSave={handleSave}
            onCancel={handleCancel}
          />
        ) : (
          <ImageModelForm
            isNew
            saving={saving}
            onSave={handleSave}
            onCancel={handleCancel}
          />
        )}
      </Stack>
    );
  }

  // --- Edit mode ---
  if (isEditing) {
    return (
      <Stack gap="md">
        <Title order={2}>
          Edit: {llm?.label || img?.label}
          {!isCustom && (
            <Text span size="sm" c="dimmed" ml="xs">
              (creating custom override)
            </Text>
          )}
        </Title>
        {saveError && (
          <Alert
            color="red"
            title="Error"
            onClose={() => setSaveError(null)}
            withCloseButton
          >
            {saveError}
          </Alert>
        )}
        {modelType === "llm" ? (
          <LlmModelForm
            key="edit"
            model={llm}
            saving={saving}
            onSave={handleSave}
            onCancel={handleCancel}
          />
        ) : (
          <ImageModelForm
            key="edit"
            model={img}
            saving={saving}
            onSave={handleSave}
            onCancel={handleCancel}
          />
        )}
      </Stack>
    );
  }

  // --- Read-only view ---
  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>{llm?.label || img?.label}</Title>
        {hasAction(
          actions,
          modelType === "llm" ? "save-llm" : "save-image",
        ) && (
          <Group gap="xs">
            <Button
              color="blue"
              leftSection={<IconEdit size={16} />}
              onClick={handleEdit}
            >
              {isCustom ? "Edit" : "Override"}
            </Button>
            {isCustom && hasAction(actions, "delete") && (
              <Button
                color="red"
                variant="outline"
                leftSection={<IconTrash size={16} />}
                onClick={() => setDeleteConfirmOpen(true)}
              >
                Delete
              </Button>
            )}
          </Group>
        )}
      </Group>

      {saveError && (
        <Alert
          color="red"
          title="Error"
          onClose={() => setSaveError(null)}
          withCloseButton
        >
          {saveError}
        </Alert>
      )}

      {llm && <LlmReadOnlyTable model={llm} />}
      {img && <ImageReadOnlyTable model={img} />}

      <Modal
        opened={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title="Delete Custom Model"
        centered
      >
        <Stack gap="md">
          <Text>
            Are you sure you want to delete this custom model? This action
            cannot be undone.
          </Text>
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => setDeleteConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button color="red" onClick={handleDelete}>
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

// --- Read-only sub-components ---

function LlmReadOnlyTable({
  model,
}: {
  model: {
    key: string;
    label: string;
    versionName: string;
    apiType: string;
    maxTokens: number;
    baseUrl?: string;
    keyEnvVar: string;
    inputCost: number;
    outputCost: number;
    cacheWriteCost?: number;
    cacheReadCost?: number;
  };
}) {
  const rows: [string, string | number][] = [
    ["Key", model.key],
    ["Label", model.label],
    ["Version Name", model.versionName],
    ["API Type", model.apiType],
    ["Base URL", model.baseUrl || "\u2014"],
    ["Key Env Var", model.keyEnvVar || "\u2014"],
    ["Max Tokens", model.maxTokens.toLocaleString()],
    ["Input Cost (per 1M tokens)", `$${model.inputCost}`],
    ["Output Cost (per 1M tokens)", `$${model.outputCost}`],
  ];
  if (model.cacheWriteCost !== undefined) {
    rows.push(["Cache Write Cost (per 1M tokens)", `$${model.cacheWriteCost}`]);
  }
  if (model.cacheReadCost !== undefined) {
    rows.push(["Cache Read Cost (per 1M tokens)", `$${model.cacheReadCost}`]);
  }

  return (
    <Table striped>
      <Table.Tbody>
        {rows.map(([label, value]) => (
          <Table.Tr key={label}>
            <Table.Td fw={500} w="40%">
              {label}
            </Table.Td>
            <Table.Td>{value}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function ImageReadOnlyTable({
  model,
}: {
  model: {
    key: string;
    label: string;
    versionName: string;
    size: string;
    baseUrl?: string;
    keyEnvVar: string;
    cost: number;
    quality?: string;
  };
}) {
  const rows: [string, string | number][] = [
    ["Key", model.key],
    ["Label", model.label],
    ["Version Name", model.versionName],
    ["Size", model.size],
    ["Base URL", model.baseUrl || "\u2014"],
    ["Key Env Var", model.keyEnvVar || "\u2014"],
    ["Cost (per image)", `$${model.cost}`],
  ];
  if (model.quality) {
    rows.push(["Quality", model.quality]);
  }

  return (
    <Table striped>
      <Table.Tbody>
        {rows.map(([label, value]) => (
          <Table.Tr key={label}>
            <Table.Td fw={500} w="40%">
              {label}
            </Table.Td>
            <Table.Td>{value}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
