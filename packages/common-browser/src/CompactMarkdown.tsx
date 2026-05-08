import type { Components } from "react-markdown";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

const compactComponents: Components = {
  p: ({ children }) => (
    <p style={{ marginBlockStart: "0.5em", marginBlockEnd: "0.5em" }}>
      {children}
    </p>
  ),
  blockquote: ({ children }) => (
    <blockquote
      style={{
        marginBlockStart: "0em",
        marginBlockEnd: "0em",
      }}
    >
      {children}
    </blockquote>
  ),
  ul: ({ children }) => (
    <ul style={{ margin: "0.25em 0", paddingLeft: "1.5em" }}>{children}</ul>
  ),
  ol: ({ children }) => (
    <ol style={{ margin: "0.25em 0", paddingLeft: "1.5em" }}>{children}</ol>
  ),
  table: ({ children }) => (
    <table
      style={{
        borderCollapse: "collapse",
        margin: "0.5em 0",
        fontSize: "inherit",
      }}
    >
      {children}
    </table>
  ),
  th: ({ children }) => (
    <th
      style={{
        border: "1px solid var(--mantine-color-default-border)",
        padding: "4px 8px",
        textAlign: "left",
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td
      style={{
        border: "1px solid var(--mantine-color-default-border)",
        padding: "4px 8px",
      }}
    >
      {children}
    </td>
  ),
};

export const CompactMarkdown: React.FC<{ children: string }> = ({
  children,
}) => (
  <Markdown remarkPlugins={[remarkGfm]} components={compactComponents}>
    {children}
  </Markdown>
);
