-- Fix data corruption from migration 20260322000000_add_field_sets.
-- That migration used `INSERT INTO ... SELECT * FROM` when recreating
-- step_field_values with set_index in a new column position. Since
-- ALTER TABLE ADD COLUMN appends at the end, SELECT * returned columns
-- in physical order (set_index last), causing all data after field_id
-- to shift by one column.
--
-- In corrupted rows the columns are mapped as:
--   set_index  <- original value
--   value      <- original created_at
--   created_at <- original created_by  (integer)
--   created_by <- original updated_at  (timestamp text)
--   updated_at <- original updated_by  (integer)
--   updated_by <- original set_index   (integer, usually 0)
--
-- Detect corrupted rows by checking if created_by holds a timestamp
-- string instead of an integer user ID.

UPDATE "field_values" SET
  "set_index"  = "updated_by",
  "value"      = "set_index",
  "created_at" = "value",
  "created_by" = "created_at",
  "updated_at" = "created_by",
  "updated_by" = "updated_at"
WHERE typeof("created_by") = 'text';
