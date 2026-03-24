import { Autocomplete, type AutocompleteProps } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import type { WorkCenterListResponse } from "@naisys-erp/shared";
import { useCallback, useEffect, useState } from "react";

import { api, apiEndpoints } from "../lib/api";

interface WorkCenterAutocompleteProps extends Omit<
  AutocompleteProps,
  "data" | "onChange"
> {
  value: string;
  onChange: (value: string) => void;
}

export const WorkCenterAutocomplete: React.FC<WorkCenterAutocompleteProps> = ({
  value,
  onChange,
  ...rest
}) => {
  const [debouncedValue] = useDebouncedValue(value, 300);
  const [options, setOptions] = useState<string[]>([]);

  const fetchOptions = useCallback(async (search: string) => {
    try {
      const params = new URLSearchParams();
      params.set("pageSize", "10");
      if (search) params.set("search", search);
      const result = await api.get<WorkCenterListResponse>(
        `${apiEndpoints.workCenters}?${params}`,
      );
      setOptions(result.items.map((wc) => wc.key));
    } catch {
      setOptions([]);
    }
  }, []);

  useEffect(() => {
    void fetchOptions(debouncedValue);
  }, [debouncedValue, fetchOptions]);

  return (
    <Autocomplete data={options} value={value} onChange={onChange} {...rest} />
  );
};
