import { AgentRuntime, createAgentRuntime } from "./agentRuntime.js";
import { OutputColor } from "./utils/output.js";

/** Handles the multiplexing of multiple concurrent agents in the process */
export class AgentManager {
  runningAgents: AgentRuntime[] = [];
  runLoops: Promise<void>[] = [];

  async startAgent(agentPath: string, onStop?: (reason: string) => void) {
    // Get rid of all of this and do in the main function when all direct config imports are removed

    const agent = await createAgentRuntime(this, agentPath);

    this.runningAgents.push(agent);

    if (this.runningAgents.length === 1) {
      this.setActiveConsoleAgent(agent.agentRuntimeId);
    }

    let stopReason = "";

    agent
      .runCommandLoop()
      .then(() => {
        stopReason = "completed";
      })
      .catch((ex) => {
        stopReason = `error: ${ex}`;
      })
      .finally(() => {
        // Notify subagent manager that this agent has stopped
        onStop?.(stopReason);

        this.stopAgent(
          agent.agentRuntimeId,
          "completeShutdown",
          `${agent.config.agent.username} shutdown`,
        );
      });

    return agent.agentRuntimeId;
  }

  async stopAgent(
    agentRuntimeId: number,
    stage: "completeShutdown" | "requestShutdown",
    reason: string,
  ) {
    const agent = this.runningAgents.find(
      (a) => a.agentRuntimeId === agentRuntimeId,
    );

    if (!agent) {
      if (stage == "requestShutdown") {
        throw new Error(`Agent with runtime ID ${agentRuntimeId} not found`);
      }
      // Else the function was probably falled from the finally block above triggered by the shutdown below
      return;
    }

    if (agent.output.isConsoleEnabled()) {
      const switchToAgent = this.runningAgents.find((a) => a !== agent);

      if (switchToAgent) {
        this.setActiveConsoleAgent(switchToAgent.agentRuntimeId);
      }
    }

    if (stage == "requestShutdown") {
      // Use abort controller to gracefully stop the agent, whcih should trigger the finally block above
      await agent.requestShutdown(reason);
    }

    if (stage == "completeShutdown") {
      const agentIndex = this.runningAgents.findIndex((a) => a === agent);
      this.runningAgents.splice(agentIndex, 1);

      agent.completeShutdown(reason);
    }
  }

  setActiveConsoleAgent(id: number) {
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
      prevActiveAgent.output.write(
        `Switching to agent ${newActiveAgent.config.agent.username} (ID: ${newActiveAgent.agentRuntimeId})`,
        OutputColor.subagent,
      );
      prevActiveAgent.output.setConsoleEnabled(false);
    }

    // This will show at the bottom of the flushed output for the newly active agent
    /*newActiveAgent.output.write(
      `Switched to agent ${newActiveAgent.config.agent.username} (ID: ${newActiveAgent.agentRuntimeId})`,
      OutputColor.subagent,
    );*/

    // Enable console for the active agent, disable for others
    newActiveAgent.output.setConsoleEnabled(true);

    // This switch even is used to break the input prompt timeout of the newly active agent
    if (prevActiveAgent) {
      newActiveAgent.subagentService.raiseSwitchEvent();
    }
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
