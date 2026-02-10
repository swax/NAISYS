import { Container, Title } from "@mantine/core";
import { useNavigate, useSearchParams } from "react-router";
import {
  ExecutionOrderForm,
  type ExecutionOrderFormData,
} from "../components/ExecutionOrderForm";
import { api } from "../lib/api";

export const ExecutionOrderCreate: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const prefillPlanOrderId = Number(searchParams.get("planOrderId")) || 0;
  const prefillPlanOrderRevId = Number(searchParams.get("planOrderRevId")) || 0;

  const handleCreate = async (data: ExecutionOrderFormData) => {
    await api.post("execution/orders", {
      planOrderId: data.planOrderId,
      planOrderRevId: data.planOrderRevId,
      priority: data.priority,
      scheduledStartAt: data.scheduledStartAt || undefined,
      dueAt: data.dueAt || undefined,
      assignedTo: data.assignedTo || undefined,
      notes: data.notes || undefined,
      createdBy: 1,
    });
    navigate("/execution/orders");
  };

  return (
    <Container size="md" py="xl">
      <Title order={2} mb="lg">
        Create Execution Order
      </Title>
      <ExecutionOrderForm
        initialData={{
          planOrderId: prefillPlanOrderId || undefined,
          planOrderRevId: prefillPlanOrderRevId || undefined,
        }}
        onSubmit={handleCreate}
        onCancel={() => navigate("/execution/orders")}
      />
    </Container>
  );
};
