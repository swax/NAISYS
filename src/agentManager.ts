import { AgentRuntime, createAgentRuntime } from "./agentRuntime.js";
import { OutputColor } from "./utils/output.js";

/** Handles the multiplexing of multiple concurrent agents in the process */
export class AgentManager {
  runningAgents: AgentRuntime[] = [];
  runLoops: Promise<void>[] = [];

  async start(agentPath: string, onStop?: (reason: string) => void) {
    // Get rid of all of this and do in the main function when all direct config imports are removed

    const agent = await createAgentRuntime(this, agentPath);

    this.runningAgents.push(agent);

    if (this.runningAgents.length === 1) {
      this.setActive(agent.agentRuntimeId);
    }

    let stopReason = "";

    agent.commandLoop
      .run()
      .then(() => {
        stopReason = "completed";
      })
      .catch((ex) => {
        stopReason = `error: ${ex}`;
      })
      .finally(() => {
        onStop?.(stopReason);

        this.runningAgents = this.runningAgents.filter((a) => a !== agent);

        // If the stopped agent was active, set a new active agent
        if (agent.output.isConsoleEnabled() && this.runningAgents.length > 0) {
          this.setActive(this.runningAgents[0].agentRuntimeId);
        }
      });

    return agent.agentRuntimeId;
  }

  async stop(agentRuntimeId: number) {
    const agent = this.runningAgents.find(
      (a) => a.agentRuntimeId === agentRuntimeId,
    );

    if (!agent) {
      throw new Error(`Agent with runtime ID ${agentRuntimeId} not found`);
    }

    // Use abort controller to gracefully stop the agent
    await agent.shutdown();

    // Cleanup happens in the finally block of the start method
    this.runningAgents = this.runningAgents.filter((a) => a !== agent);
  }

  setActive(id: number) {
    const newActiveAgent = this.runningAgents.find(
      (a) => a.agentRuntimeId === id,
    );

    if (!newActiveAgent) {
      throw new Error(`Agent with runtime ID ${id} not found`);
    }

    if (newActiveAgent.output.isConsoleEnabled()) {
      throw new Error(`Agent with runtime ID ${id} is already active`);
    }

    const prevActiveAgent = this.runningAgents.find((a) =>
      a.output.isConsoleEnabled(),
    );

    if (prevActiveAgent) {
      // Last output from the previously active agent
      if (newActiveAgent.output.consoleBuffer.length) {
        prevActiveAgent.output.write(
          `Switching to agent ${newActiveAgent.config.agent.username} (ID: ${newActiveAgent.agentRuntimeId})`,
          OutputColor.subagent,
        );
      }
      prevActiveAgent.output.setConsoleEnabled(false);
    }

    // This will show at the bottom of the flushed output for the newly active agent
    newActiveAgent.output.write(
      `Switched to agent ${newActiveAgent.config.agent.username} (ID: ${newActiveAgent.agentRuntimeId})`,
      OutputColor.subagent,
    );

    // Enable console for the active agent, disable for others
    newActiveAgent.output.setConsoleEnabled(true);
  }

  getBufferLines(id: number) {
    const agent = this.runningAgents.find((a) => a.agentRuntimeId === id);

    if (!agent) {
      return 0;
    }

    return agent.output.consoleBuffer.length;
  }

  async waitForAllAgentsToComplete() {
    // poll every second to see if there are running agents
    while (this.runningAgents.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
