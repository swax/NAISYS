import {
  TextInput,
  Textarea,
  Select,
  Button,
  Group,
  Stack,
} from "@mantine/core";
import { useState } from "react";

export interface PlanningOrderFormData {
  key?: string;
  name: string;
  description: string;
  status?: string;
}

interface Props {
  initialData?: PlanningOrderFormData;
  isEdit?: boolean;
  onSubmit: (data: PlanningOrderFormData) => Promise<void>;
  onCancel: () => void;
}

export const PlanningOrderForm: React.FC<Props> = ({
  initialData,
  isEdit,
  onSubmit,
  onCancel,
}) => {
  const [key, setKey] = useState(initialData?.key ?? "");
  const [name, setName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(
    initialData?.description ?? "",
  );
  const [status, setStatus] = useState(initialData?.status ?? "active");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data: PlanningOrderFormData = { name, description };
      if (!isEdit) data.key = key;
      if (isEdit) data.status = status;
      await onSubmit(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <Stack gap="md">
        {!isEdit && (
          <TextInput
            label="Key"
            description="Unique identifier (lowercase, hyphens allowed)"
            placeholder="standard-order"
            required
            value={key}
            onChange={(e) => setKey(e.currentTarget.value)}
            pattern="^[a-z0-9-]+$"
          />
        )}
        <TextInput
          label="Name"
          placeholder="Standard Order"
          required
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <Textarea
          label="Description"
          placeholder="Describe this planning order..."
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          minRows={3}
        />
        {isEdit && (
          <Select
            label="Status"
            data={[
              { value: "active", label: "Active" },
              { value: "archived", label: "Archived" },
            ]}
            value={status}
            onChange={(val) => setStatus(val ?? "active")}
          />
        )}
        {error && (
          <div style={{ color: "var(--mantine-color-red-6)" }}>{error}</div>
        )}
        <Group>
          <Button type="submit" loading={loading}>
            {isEdit ? "Save Changes" : "Create"}
          </Button>
          <Button variant="subtle" onClick={onCancel}>
            Cancel
          </Button>
        </Group>
      </Stack>
    </form>
  );
};
