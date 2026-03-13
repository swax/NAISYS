import {
  Button,
  Container,
  Group,
  Stack,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { useState } from "react";
import { useNavigate } from "react-router";

import { api, apiEndpoints, showErrorNotification } from "../../lib/api";

export const ItemCreate: React.FC = () => {
  const navigate = useNavigate();
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await api.post(apiEndpoints.items, { key, description });
      void navigate("/items");
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Container size="md" py="xl">
      <Title order={2} mb="lg">
        Create Item
      </Title>
      <Stack>
        <TextInput
          label="Key"
          description="Alphanumeric with hyphens"
          value={key}
          onChange={(e) => setKey(e.currentTarget.value)}
          required
          data-autofocus
        />
        <Textarea
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          autosize
          minRows={2}
        />
        <Group justify="flex-end">
          <Button variant="subtle" onClick={() => navigate("/items")}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={submitting} disabled={!key}>
            Create
          </Button>
        </Group>
      </Stack>
    </Container>
  );
};
