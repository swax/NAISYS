import { Container, Title } from "@mantine/core";
import type { CreateOrder } from "@naisys-erp/shared";
import { useNavigate } from "react-router";

import { OrderForm } from "../../components/OrderForm";
import { api, apiEndpoints } from "../../lib/api";

export const OrderCreate: React.FC = () => {
  const navigate = useNavigate();

  const handleCreate = async (data: CreateOrder) => {
    await api.post(apiEndpoints.orders, data);
    void navigate("/orders");
  };

  return (
    <Container size="md" py="xl">
      <Title order={2} mb="lg">
        Create Order
      </Title>
      <OrderForm<false>
        onSubmit={handleCreate}
        onCancel={() => navigate("/orders")}
      />
    </Container>
  );
};
