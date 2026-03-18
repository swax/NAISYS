import {
  Badge,
  Button,
  Group,
  Loader,
  NumberInput,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import type {
  CreateOperationDependency,
  OperationDependency,
  OperationDependencyListResponse,
} from "@naisys-erp/shared";
import { CreateOperationDependencySchema } from "@naisys-erp/shared";
import { useCallback, useEffect, useState } from "react";

import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";
import { hasAction, hasActionTemplate } from "../../../lib/hateoas";
import { zodResolver } from "@naisys/common-browser";

interface DependencyListProps {
  orderKey: string;
  revNo: string;
  opSeqNo: string;
  showTitle?: boolean;
}

export const DependencyList: React.FC<DependencyListProps> = ({
  orderKey,
  revNo,
  opSeqNo,
  showTitle = true,
}) => {
  const [deps, setDeps] = useState<OperationDependencyListResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadedOpSeqNo, setLoadedOpSeqNo] = useState(opSeqNo);

  // Clear stale data when operation changes
  if (opSeqNo !== loadedOpSeqNo) {
    setLoadedOpSeqNo(opSeqNo);
    setDeps(null);
    setLoading(true);
    setAdding(false);
  }

  const createForm = useForm<CreateOperationDependency>({
    initialValues: { predecessorSeqNo: 10 },
    validate: zodResolver(CreateOperationDependencySchema),
  });

  const fetchDeps = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<OperationDependencyListResponse>(
        apiEndpoints.orderRevOpDeps(orderKey, revNo, opSeqNo),
      );
      setDeps(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [orderKey, revNo, opSeqNo]);

  useEffect(() => {
    void fetchDeps();
  }, [fetchDeps]);

  const handleCreate = async (values: CreateOperationDependency) => {
    if (!deps) return;
    setSaving(true);
    try {
      const created = await api.post<OperationDependency>(
        apiEndpoints.orderRevOpDeps(orderKey, revNo, opSeqNo),
        values,
      );
      setAdding(false);
      setDeps({
        ...deps,
        items: [...deps.items, created].sort(
          (a, b) => a.predecessorSeqNo - b.predecessorSeqNo,
        ),
        total: deps.total + 1,
      });
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (dep: OperationDependency) => {
    if (!deps) return;
    try {
      await api.delete(
        apiEndpoints.orderRevOpDep(
          orderKey,
          revNo,
          opSeqNo,
          dep.predecessorSeqNo,
        ),
      );
      setDeps({
        ...deps,
        items: deps.items.filter((d) => d.id !== dep.id),
        total: deps.total - 1,
      });
    } catch (err) {
      showErrorNotification(err);
    }
  };

  return (
    <>
      <Group justify="space-between">
        {showTitle && <Title order={5}>Dependencies</Title>}
        {hasAction(deps?._actions, "create") && !adding && (
          <Button
            size="xs"
            variant="light"
            onClick={() => {
              createForm.reset();
              setAdding(true);
            }}
          >
            Add Dependency
          </Button>
        )}
      </Group>

      {loading ? (
        <Stack align="center" py="sm">
          <Loader size="sm" />
        </Stack>
      ) : (
        <Stack gap="xs">
          {deps?.items.map((dep) => (
            <Group key={dep.id} gap="xs">
              <Badge variant="light" size="lg">
                {dep.predecessorSeqNo}. {dep.predecessorTitle}
              </Badge>
              {hasActionTemplate(
                deps?._actionTemplates,
                "deleteDependency",
              ) && (
                <Button
                  size="compact-xs"
                  color="red"
                  variant="subtle"
                  onClick={() => handleDelete(dep)}
                >
                  Remove
                </Button>
              )}
            </Group>
          ))}

          {deps && deps.items.length === 0 && !adding && (
            <Text size="sm" c="dimmed">
              No dependencies.
            </Text>
          )}

          {adding && (
            <form onSubmit={createForm.onSubmit(handleCreate)}>
              <Group gap="sm">
                <NumberInput
                  placeholder="Predecessor op #"
                  min={1}
                  step={10}
                  size="xs"
                  style={{ width: 160 }}
                  {...createForm.getInputProps("predecessorSeqNo")}
                />
                <Button type="submit" size="xs" loading={saving}>
                  Add
                </Button>
                <Button
                  variant="subtle"
                  size="xs"
                  onClick={() => setAdding(false)}
                >
                  Cancel
                </Button>
              </Group>
            </form>
          )}
        </Stack>
      )}
    </>
  );
};
