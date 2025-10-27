import { AgentRuntime, createAgentRuntime } from "./agentRuntime.js";

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
        if (agent.config.consoleEnabled && this.runningAgents.length > 0) {
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

  setActive(agentRuntimeId: number) {
    this.runningAgents.forEach((a) => {
      a.config.consoleEnabled = a.agentRuntimeId === agentRuntimeId;
      if (a.config.consoleEnabled) {
        a.output.flushBuffer();
      }
    });
  }

  async waitForAllAgentsToComplete() {
    // poll every second to see if there are running agents
    while (this.runningAgents.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
