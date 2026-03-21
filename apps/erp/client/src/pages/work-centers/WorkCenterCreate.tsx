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

export const WorkCenterCreate: React.FC = () => {
  const navigate = useNavigate();
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await api.post(apiEndpoints.workCenters, { key, description });
      void navigate(`/work-centers/${key}`);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Container size="md" py="xl">
      <Title order={2} mb="lg">
        Create Work Center
      </Title>
      <Stack>
        <TextInput
          label="Key"
          description="Alphanumeric with hyphens"
          value={key}
          onChange={(e) => setKey(e.currentTarget.value)}
          required
        />
        <Textarea
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          autosize
          minRows={2}
        />
        <Group justify="flex-end">
          <Button variant="subtle" onClick={() => navigate("/work-centers")}>
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
