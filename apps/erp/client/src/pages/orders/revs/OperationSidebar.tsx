import {
  Button,
  Card,
  Group,
  Loader,
  Modal,
  NumberInput,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { zodResolver } from "@naisys/common-browser";
import type { Operation, OperationListResponse } from "@naisys/erp-shared";
import { CreateOperationSchema } from "@naisys/erp-shared";
import { IconPlus } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";

import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";
import { hasAction } from "../../../lib/hateoas";

interface Props {
  orderKey: string;
  revNo: string;
  refreshKey?: number;
}

export const OperationSidebar: React.FC<Props> = ({
  orderKey,
  revNo,
  refreshKey,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { seqNo: currentSeqNo } = useParams<{ seqNo: string }>();
  const isHeaderActive = location.pathname.endsWith("/header");
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
  }, [fetchOps, refreshKey]);

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
      <Stack gap="xs">
        <Card
          padding="sm"
          radius="md"
          withBorder
          component="a"
          href={`/erp/orders/${orderKey}/revs/${revNo}/header`}
          onClick={(e: React.MouseEvent) => {
            if (e.button === 1 || e.ctrlKey || e.metaKey) return;
            e.preventDefault();
            void navigate(`/orders/${orderKey}/revs/${revNo}/header`);
          }}
          style={{
            cursor: "pointer",
            textDecoration: "none",
            color: "inherit",
            backgroundColor: isHeaderActive
              ? "var(--mantine-color-blue-9)"
              : undefined,
          }}
        >
          <Text size="sm" fw={500}>
            Header
          </Text>
        </Card>

        {loading ? (
          <Stack align="center" py="md">
            <Loader size="sm" />
          </Stack>
        ) : !data || data.items.length === 0 ? (
          <Text c="dimmed" size="sm" ta="center" py="md">
            No operations yet.
          </Text>
        ) : (
          data.items.map((op) => {
            const url = `/orders/${orderKey}/revs/${revNo}/ops/${op.seqNo}`;
            return (
              <Card
                key={op.id}
                padding="sm"
                radius="md"
                withBorder
                component="a"
                href={`/erp${url}`}
                onClick={(e: React.MouseEvent) => {
                  if (e.button === 1 || e.ctrlKey || e.metaKey) return;
                  e.preventDefault();
                  void navigate(url);
                }}
                style={{
                  cursor: "pointer",
                  textDecoration: "none",
                  color: "inherit",
                  backgroundColor:
                    currentSeqNo === String(op.seqNo)
                      ? "var(--mantine-color-blue-9)"
                      : undefined,
                }}
              >
                <Text size="sm" fw={500}>
                  {op.seqNo}. {op.title}
                </Text>
              </Card>
            );
          })
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
              autosize
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
