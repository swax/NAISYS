-- Rename context_log type enum value: workspace -> tool
UPDATE "context_log" SET "type" = 'tool' WHERE "type" = 'workspace';
