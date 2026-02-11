import { Container, Title } from "@mantine/core";
import { useNavigate, useSearchParams } from "react-router";
import type { CreateExecutionOrder } from "@naisys-erp/shared";
import { ExecutionOrderForm } from "../components/ExecutionOrderForm";
import { api } from "../lib/api";

export const ExecutionOrderCreate: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const prefillPlanOrderId = Number(searchParams.get("planOrderId")) || 0;
  const prefillPlanOrderRevId = Number(searchParams.get("planOrderRevId")) || 0;

  const handleCreate = async (data: CreateExecutionOrder) => {
    await api.post("execution/orders", data);
    navigate("/execution/orders");
  };

  return (
    <Container size="md" py="xl">
      <Title order={2} mb="lg">
        Create Execution Order
      </Title>
      <ExecutionOrderForm<false>
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
