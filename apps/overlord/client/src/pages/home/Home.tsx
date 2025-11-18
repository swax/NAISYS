import React from "react";

const cardStyle: React.CSSProperties = {
  backgroundColor: "#1e1e1e",
  border: "1px solid #404040",
  borderRadius: "8px",
  padding: "1.5rem",
  marginBottom: "1.5rem",
  boxShadow: "0 2px 4px rgba(0, 0, 0, 0.3)",
};

const headerStyle: React.CSSProperties = {
  color: "#e0e0e0",
  marginTop: "0",
  marginBottom: "0.75rem",
  fontSize: "1.5rem",
  fontWeight: "600",
};

const featureItemStyle: React.CSSProperties = {
  marginBottom: "0.75rem",
  lineHeight: "1.6",
};

const labelStyle: React.CSSProperties = {
  color: "#5dade2",
  fontWeight: "600",
  marginRight: "0.5rem",
};

export const Home: React.FC = () => {
  return (
    <div
      style={{
        maxWidth: "900px",
        margin: "0 auto",
        padding: "2rem",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div style={{ marginBottom: "3rem", textAlign: "center" }}>
        <h1
          style={{
            fontSize: "2.5rem",
            fontWeight: "700",
            color: "#f0f0f0",
            marginBottom: "0.5rem",
          }}
        >
          NAISYS Overlord
        </h1>
        <p
          style={{
            fontSize: "1.2rem",
            color: "#b0b0b0",
            marginBottom: "0.75rem",
          }}
        >
          An interface for monitoring and controlling NAISYS agents
        </p>
        <p
          style={{
            fontSize: "1rem",
            color: "#888",
            fontStyle: "italic",
            marginBottom: "0",
          }}
        >
          NAISYS is a free open source self-hosted multi agent coordination and
          management system
        </p>
      </div>

      <section style={cardStyle}>
        <h2 style={headerStyle}>Overview</h2>
        <p style={{ lineHeight: "1.6", color: "#b8b8b8", margin: "0" }}>
          NAISYS Overlord provides a centralized view of all agents in your
          organization. Agents in the same organization share a SQLite database
          to write console logs, record cost information, and send mail between
          each other. Overlord watches this database and displays an overview,
          allowing you to see what all agents are doing without manually having
          to switch between sessions on the console.
        </p>
      </section>

      <section style={cardStyle}>
        <h2 style={headerStyle}>Remote Monitoring</h2>
        <p style={{ lineHeight: "1.6", color: "#b8b8b8", margin: "0" }}>
          Monitor agent status and progress remotely. Agents run on the Linux
          CLI and have the ability to start subagents as specified by their
          configuration. Each agent's configuration defines their task, lead
          agent, AI LLM model to use, spending limits, and more.
        </p>
      </section>

      <section style={cardStyle}>
        <h2 style={headerStyle}>Sidebar</h2>
        <p style={{ lineHeight: "1.6", color: "#b8b8b8", margin: "0" }}>
          The sidebar on the left shows all agents in your organization, lit up
          if they are currently online. Click on any agent to view detailed
          information and controls.
        </p>
      </section>

      <section style={cardStyle}>
        <h2 style={headerStyle}>Agent Details</h2>
        <p style={{ lineHeight: "1.6", color: "#b8b8b8", marginBottom: "1rem" }}>
          When you select an agent, you can:
        </p>
        <div>
          <div style={featureItemStyle}>
            <span style={labelStyle}>Logs:</span>
            <span style={{ color: "#b8b8b8" }}>
              Read console logs broken down by distinct runs
            </span>
          </div>
          <div style={featureItemStyle}>
            <span style={labelStyle}>Mail:</span>
            <span style={{ color: "#b8b8b8" }}>
              View mail sent to and from the agent
            </span>
          </div>
          <div style={featureItemStyle}>
            <span style={labelStyle}>Config:</span>
            <span style={{ color: "#b8b8b8" }}>
              View and edit the agent's configuration
            </span>
          </div>
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={headerStyle}>Communication</h2>
        <p style={{ lineHeight: "1.6", color: "#b8b8b8", margin: "0" }}>
          Operators can communicate with agents through the mail system,
          enabling direct interaction and control over agent operations.
        </p>
      </section>
    </div>
  );
};
