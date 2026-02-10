import {
  TextInput,
  Textarea,
  Select,
  Button,
  Group,
  Stack,
  NumberInput,
} from "@mantine/core";
import { useState } from "react";

export interface ExecutionOrderFormData {
  planOrderId?: number;
  planOrderRevId?: number;
  priority: string;
  scheduledStartAt: string;
  dueAt: string;
  assignedTo: string;
  notes: string;
}

interface Props {
  initialData?: Partial<ExecutionOrderFormData>;
  isEdit?: boolean;
  onSubmit: (data: ExecutionOrderFormData) => Promise<void>;
  onCancel: () => void;
}

export const ExecutionOrderForm: React.FC<Props> = ({
  initialData,
  isEdit,
  onSubmit,
  onCancel,
}) => {
  const [planOrderId, setPlanOrderId] = useState(initialData?.planOrderId ?? 0);
  const [planOrderRevId, setPlanOrderRevId] = useState(
    initialData?.planOrderRevId ?? 0,
  );
  const [priority, setPriority] = useState(initialData?.priority ?? "medium");
  const [scheduledStartAt, setScheduledStartAt] = useState(
    initialData?.scheduledStartAt ?? "",
  );
  const [dueAt, setDueAt] = useState(initialData?.dueAt ?? "");
  const [assignedTo, setAssignedTo] = useState(initialData?.assignedTo ?? "");
  const [notes, setNotes] = useState(initialData?.notes ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data: ExecutionOrderFormData = {
        priority,
        scheduledStartAt,
        dueAt,
        assignedTo,
        notes,
      };
      if (!isEdit) {
        data.planOrderId = planOrderId;
        data.planOrderRevId = planOrderRevId;
      }
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
          <>
            <NumberInput
              label="Planning Order ID"
              required
              min={1}
              value={planOrderId || ""}
              onChange={(val) => setPlanOrderId(Number(val) || 0)}
            />
            <NumberInput
              label="Planning Order Revision ID"
              required
              min={1}
              value={planOrderRevId || ""}
              onChange={(val) => setPlanOrderRevId(Number(val) || 0)}
            />
          </>
        )}
        <Select
          label="Priority"
          data={[
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
            { value: "critical", label: "Critical" },
          ]}
          value={priority}
          onChange={(val) => setPriority(val ?? "medium")}
        />
        <TextInput
          label="Scheduled Start"
          type="datetime-local"
          value={scheduledStartAt}
          onChange={(e) => setScheduledStartAt(e.currentTarget.value)}
        />
        <TextInput
          label="Due Date"
          type="datetime-local"
          value={dueAt}
          onChange={(e) => setDueAt(e.currentTarget.value)}
        />
        <TextInput
          label="Assigned To"
          placeholder="Person or team"
          value={assignedTo}
          onChange={(e) => setAssignedTo(e.currentTarget.value)}
        />
        <Textarea
          label="Notes"
          placeholder="Additional notes..."
          value={notes}
          onChange={(e) => setNotes(e.currentTarget.value)}
          minRows={3}
        />
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
