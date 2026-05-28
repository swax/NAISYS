import { Autocomplete, type AutocompleteProps } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import type { UserListResponse } from "@naisys/erp-shared";
import { useCallback, useEffect, useState } from "react";

import { api, apiEndpoints } from "../lib/api";
import { formatUserLabel } from "../lib/userLabel";

interface UserOption {
  id: number;
  username: string;
  title: string;
}

interface UserAutocompleteProps extends Omit<
  AutocompleteProps,
  "data" | "onChange"
> {
  value: string;
  onChange: (value: string) => void;
  /** Called with the full user option when a dropdown item is selected */
  onUserSelect?: (user: UserOption) => void;
}

export const UserAutocomplete: React.FC<UserAutocompleteProps> = ({
  value,
  onChange,
  onUserSelect,
  ...rest
}) => {
  const [debouncedValue] = useDebouncedValue(value, 300);
  const [options, setOptions] = useState<UserOption[]>([]);

  const fetchOptions = useCallback(async (search: string) => {
    try {
      const params = new URLSearchParams();
      params.set("pageSize", "10");
      if (search) params.set("search", search);
      const result = await api.get<UserListResponse>(
        `${apiEndpoints.users}?${params}`,
      );
      setOptions(
        result.items.map((u) => ({
          id: u.id,
          username: u.username,
          title: u.title,
        })),
      );
    } catch {
      setOptions([]);
    }
  }, []);

  useEffect(() => {
    void fetchOptions(debouncedValue);
  }, [debouncedValue, fetchOptions]);

  // Mantine Autocomplete uses option `value` as the dropdown label by default.
  // We pass `{ value: username, label: "Title (username)" }` so the formatted
  // text is shown in the menu while submission still returns the bare username.
  const data = options.map((o) => ({
    value: o.username,
    label: formatUserLabel(o.username, o.title),
  }));

  return (
    <Autocomplete
      data={data}
      value={value}
      onChange={onChange}
      onOptionSubmit={(val) => {
        onChange(val);
        const match = options.find((o) => o.username === val);
        if (match && onUserSelect) {
          onUserSelect(match);
        }
      }}
      {...rest}
    />
  );
};
