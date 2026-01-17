import { FastifyInstance, FastifyPluginOptions } from "fastify";
import { getSettings, saveSettings } from "../services/settingsService.js";
import { validateSession } from "./access.js";
import {
  SettingsRequest,
  SettingsRequestSchema,
  SettingsResponse,
  SettingsResponseSchema,
  SettingsSchema,
  ErrorResponseSchema,
} from "shared";

export default async function settingsRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  // Get settings endpoint
  fastify.get<{ Reply: SettingsResponse }>(
    "/settings",
    {
      schema: {
        description: "Get application settings",
        tags: ["Settings"],
        response: {
          200: SettingsResponseSchema,
          401: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
      preHandler: validateSession,
    },
    async (request, reply) => {
      try {
        const settings = await getSettings();

        if (settings) {
          return {
            success: true,
            message: "Settings retrieved successfully",
            settings,
          };
        } else {
          // Return default settings if none exist
          return {
            success: true,
            message: "Default settings returned",
            settings: {
              example: "",
            },
          };
        }
      } catch (error) {
        reply.code(500);
        return {
          success: false,
          message: "Error retrieving settings",
        };
      }
    },
  );

  // Save settings endpoint
  fastify.post<{ Body: SettingsRequest; Reply: SettingsResponse }>(
    "/settings",
    {
      schema: {
        description: "Save application settings",
        tags: ["Settings"],
        body: SettingsRequestSchema,
        response: {
          200: SettingsResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
      preHandler: validateSession,
    },
    async (request, reply) => {
      try {
        // Validate the input with Zod
        const settings = SettingsSchema.safeParse(request.body.settings);

        if (!settings.success) {
          reply.code(400);
          return {
            success: false,
            message: `Invalid settings format: ${settings.error.message}`,
          };
        }

        // Save settings as JSON (use validated data)
        await saveSettings(settings.data);

        return {
          success: true,
          message: "Settings saved successfully",
          settings: settings.data,
        };
      } catch (error) {
        reply.code(500);
        return {
          success: false,
          message: "Error saving settings",
        };
      }
    },
  );
}
