import {
  Button,
  Group,
  Loader,
  Modal,
  NavLink,
  NumberInput,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import type { Operation, OperationListResponse } from "@naisys-erp/shared";
import { CreateOperationSchema } from "@naisys-erp/shared";
import { IconPlus } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";
import { hasAction } from "../../../lib/hateoas";
import { zodResolver } from "../../../lib/zod-resolver";

interface Props {
  orderKey: string;
  revNo: string;
}

export const OperationSidebar: React.FC<Props> = ({ orderKey, revNo }) => {
  const navigate = useNavigate();
  const { seqNo: currentSeqNo } = useParams<{ seqNo: string }>();
  const [data, setData] = useState<OperationListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm({
    initialValues: { seqNo: 10, title: "", description: "" },
    validate: zodResolver(CreateOperationSchema),
  });

  const fetchOps = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<OperationListResponse>(
        apiEndpoints.orderRevOps(orderKey, revNo),
      );
      setData(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [orderKey, revNo]);

  useEffect(() => {
    void fetchOps();
  }, [fetchOps]);

  const openCreateModal = () => {
    form.setFieldValue("seqNo", data?.nextSeqNo ?? 10);
    setModalOpen(true);
  };

  const handleCreate = async (values: typeof form.values) => {
    setSubmitting(true);
    try {
      const created = await api.post<Operation>(
        apiEndpoints.orderRevOps(orderKey, revNo),
        {
          seqNo: values.seqNo,
          title: values.title,
          description: values.description || undefined,
        },
      );
      setModalOpen(false);
      form.reset();
      await fetchOps();
      void navigate(`/orders/${orderKey}/revs/${revNo}/ops/${created.seqNo}`);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Stack gap={0}>
        {loading ? (
          <Stack align="center" py="md">
            <Loader size="sm" />
          </Stack>
        ) : !data || data.items.length === 0 ? (
          <Text c="dimmed" size="sm" ta="center" py="md">
            No operations yet.
          </Text>
        ) : (
          data.items.map((op) => (
            <NavLink
              key={op.id}
              component={Link}
              to={`/orders/${orderKey}/revs/${revNo}/ops/${op.seqNo}`}
              label={`${op.seqNo}. ${op.title}`}
              active={currentSeqNo === String(op.seqNo)}
            />
          ))
        )}

        {hasAction(data?._actions, "create") && (
          <Button
            variant="subtle"
            color="gray"
            size="compact-sm"
            leftSection={<IconPlus size="0.9rem" />}
            onClick={openCreateModal}
            fullWidth
            mt="xs"
          >
            Add Operation
          </Button>
        )}
      </Stack>

      <Modal
        opened={modalOpen}
        onClose={() => {
          setModalOpen(false);
          form.reset();
        }}
        title="Add Operation"
      >
        <form onSubmit={form.onSubmit(handleCreate)}>
          <Stack gap="md">
            <NumberInput
              label="Sequence #"
              min={1}
              step={10}
              {...form.getInputProps("seqNo")}
            />
            <TextInput
              label="Title"
              placeholder="Operation title..."
              {...form.getInputProps("title")}
            />
            <Textarea
              label="Description"
              placeholder="Optional description..."
              {...form.getInputProps("description")}
              minRows={2}
            />
            <Group justify="flex-end">
              <Button
                variant="subtle"
                onClick={() => {
                  setModalOpen(false);
                  form.reset();
                }}
              >
                Cancel
              </Button>
              <Button type="submit" loading={submitting}>
                Create
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
};
