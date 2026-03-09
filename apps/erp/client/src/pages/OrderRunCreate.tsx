import { Container, Title } from "@mantine/core";
import type { CreateOrderRun } from "@naisys-erp/shared";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { OrderRunForm } from "../components/OrderRunForm";
import { api } from "../lib/api";

export const OrderRunCreate: React.FC = () => {
  const { orderKey } = useParams<{ orderKey: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const prefillOrderRevId = Number(searchParams.get("orderRevId")) || 0;

  const handleCreate = async (data: CreateOrderRun) => {
    await api.post(`orders/${orderKey}/runs`, data);
    void navigate(`/orders/${orderKey}/runs`);
  };

  return (
    <Container size="md" py="xl">
      <Title order={2} mb="lg">
        Create Order Run
      </Title>
      <OrderRunForm<false>
        initialData={{
          orderRevId: prefillOrderRevId || undefined,
        }}
        onSubmit={handleCreate}
        onCancel={() => navigate(`/orders/${orderKey}/runs`)}
      />
    </Container>
  );
};
