import { Container, Title } from "@mantine/core";
import { useNavigate } from "react-router";
import {
  PlanningOrderForm,
  type PlanningOrderFormData,
} from "../components/PlanningOrderForm";
import { api } from "../lib/api";

export const PlanningOrderCreate: React.FC = () => {
  const navigate = useNavigate();

  const handleCreate = async (data: PlanningOrderFormData) => {
    await api.post("planning/orders", {
      ...data,
      createdBy: "admin",
    });
    navigate("/planning/orders");
  };

  return (
    <Container size="md" py="xl">
      <Title order={2} mb="lg">
        Create Planning Order
      </Title>
      <PlanningOrderForm
        onSubmit={handleCreate}
        onCancel={() => navigate("/planning/orders")}
      />
    </Container>
  );
};
