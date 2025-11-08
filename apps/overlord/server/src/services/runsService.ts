import { RunSession } from "shared";
import { usingNaisysDb } from "../database/naisysDatabase.js";
import { isAgentOnline } from "../utils/agentUtils.js";

export interface RunsData {
  runs: RunSession[];
  timestamp: string;
}

export async function getRunsData(
  userId: number,
  updatedSince?: string,
): Promise<RunsData> {
  try {
    const runSessions = await usingNaisysDb(async (prisma) => {
      // Build the where clause
      const where: any = {
        user_id: userId,
      };

      // If updatedSince is provided, only fetch runs that were updated after that time
      if (updatedSince) {
        where.last_active = {
          gt: updatedSince,
        };
      }

      return await prisma.run_session.findMany({
        where,
        orderBy: {
          last_active: "desc",
        },
      });
    });

    // Map database records to our API format
    const runs: RunSession[] = runSessions.map((session) => ({
      userId: session.user_id,
      runId: session.run_id,
      sessionId: session.session_id,
      startDate: session.start_date,
      lastActive: session.last_active,
      modelName: session.model_name,
      totalLines: session.total_lines,
      totalCost: session.total_cost,
      isOnline: isAgentOnline(session.last_active),
    }));

    return {
      runs,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Error fetching runs data:", error);

    // Return empty data on error
    return {
      runs: [],
      timestamp: new Date().toISOString(),
    };
  }
}
