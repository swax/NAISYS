import { FastifyInstance, FastifyPluginOptions } from "fastify";
import { v4 as uuidv4 } from "uuid";
import {
  createSession,
  getSession,
  deleteSession,
  deleteExpiredSessions,
} from "../services/sessionService.js";
import { AccessKeyRequest, AccessKeyResponse } from "shared";

let lastAccessRequestTime = 0;

export default async function accessRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  fastify.post<{ Body: AccessKeyRequest; Reply: AccessKeyResponse }>(
    "/access-key",
    async (request, reply) => {
      const currentTime = Date.now();

      if (currentTime - lastAccessRequestTime < 5000) {
        reply.code(429);
        return {
          success: false,
          message: "Too many requests. Please wait before trying again.",
        };
      }

      lastAccessRequestTime = currentTime;

      const { accessKey } = request.body;
      const expectedAccessKey = process.env.ACCESS_KEY;

      if (!expectedAccessKey) {
        reply.code(500);
        return {
          success: false,
          message: "Server configuration error",
        };
      }

      if (accessKey === expectedAccessKey) {
        // Generate session token
        const token = uuidv4();
        const startDate = new Date();
        const expireDate = new Date();
        expireDate.setDate(startDate.getDate() + 30); // 30 days from now

        try {
          // Store session in database
          await createSession(token, startDate, expireDate);

          // Set HTTP-only cookie
          reply.setCookie("session_token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            expires: expireDate,
            path: "/",
          });

          return {
            success: true,
            message: "Access granted",
            token,
          };
        } catch (error) {
          reply.code(500);
          return {
            success: false,
            message: "Failed to create session",
          };
        }
      } else {
        reply.code(401);
        return {
          success: false,
          message: "Access key incorrect",
        };
      }
    },
  );

  // Session validation endpoint
  fastify.get("/session", async (request, reply) => {
    const token = request.cookies.session_token;

    if (!token) {
      reply.code(401);
      return {
        success: false,
        message: "No session token",
      };
    }

    try {
      const session = await getSession(token);
      if (session) {
        return {
          success: true,
          startDate: session.startDate,
          expireDate: session.expireDate,
        };
      } else {
        reply.code(401);
        return {
          success: false,
          message: "Invalid or expired session",
        };
      }
    } catch (error) {
      reply.code(500);
      return {
        success: false,
        message: "Session validation error",
      };
    }
  });

  // Logout endpoint
  fastify.post("/logout", async (request, reply) => {
    const token = request.cookies.session_token;

    if (token) {
      try {
        await deleteSession(token);
      } catch (error) {
        // Log error but don't fail the logout
        console.error("Error deleting session:", error);
      }
    }

    reply.clearCookie("session_token", { path: "/" });
    return {
      success: true,
      message: "Logged out successfully",
    };
  });

  // Clean up expired sessions periodically
  setInterval(async () => {
    try {
      await deleteExpiredSessions();
    } catch (error) {
      console.error("Error cleaning up expired sessions:", error);
    }
  }, 60000 * 60); // Run every hour
}

// Helper function to validate session
export async function validateSession(
  request: any,
  reply: any,
): Promise<boolean> {
  const token = request.cookies.session_token;

  if (!token) {
    reply.code(401);
    return false;
  }

  try {
    const session = await getSession(token);
    if (!session) {
      reply.code(401);
      return false;
    }
    return true;
  } catch (error) {
    reply.code(500);
    return false;
  }
}
