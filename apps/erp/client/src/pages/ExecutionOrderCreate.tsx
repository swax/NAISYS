import { Container, Title } from "@mantine/core";
import type { CreateExecutionOrder } from "@naisys-erp/shared";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { ExecutionOrderForm } from "../components/ExecutionOrderForm";
import { api } from "../lib/api";

export const ExecutionOrderCreate: React.FC = () => {
  const { orderKey } = useParams<{ orderKey: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const prefillPlanOrderRevId = Number(searchParams.get("planOrderRevId")) || 0;

  const handleCreate = async (data: CreateExecutionOrder) => {
    await api.post(`orders/${orderKey}/runs`, data);
    void navigate(`/orders/${orderKey}/runs`);
  };

  return (
    <Container size="md" py="xl">
      <Title order={2} mb="lg">
        Create Execution Order
      </Title>
      <ExecutionOrderForm<false>
        initialData={{
          planOrderRevId: prefillPlanOrderRevId || undefined,
        }}
        onSubmit={handleCreate}
        onCancel={() => navigate(`/orders/${orderKey}/runs`)}
      />
    </Container>
  );
};
