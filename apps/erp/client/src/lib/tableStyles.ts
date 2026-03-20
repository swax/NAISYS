import type React from "react";

/** Style for a <Link> that fills an entire table cell, replacing the cell's own padding. Use with `<Table.Td style={{ padding: 0 }}>`. */
export const cellLinkStyle: React.CSSProperties = {
  display: "block",
  color: "inherit",
  textDecoration: "none",
  padding:
    "var(--table-vertical-spacing) var(--table-horizontal-spacing, var(--mantine-spacing-xs))",
};
