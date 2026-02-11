import { Container, Title } from "@mantine/core";
import { useNavigate } from "react-router";
import type { CreatePlanningOrder } from "shared";
import { PlanningOrderForm } from "../components/PlanningOrderForm";
import { api } from "../lib/api";

export const PlanningOrderCreate: React.FC = () => {
  const navigate = useNavigate();

  const handleCreate = async (data: CreatePlanningOrder) => {
    await api.post("planning/orders", data);
    navigate("/planning/orders");
  };

  return (
    <Container size="md" py="xl">
      <Title order={2} mb="lg">
        Create Planning Order
      </Title>
      <PlanningOrderForm<false>
        onSubmit={handleCreate}
        onCancel={() => navigate("/planning/orders")}
      />
    </Container>
  );
};
