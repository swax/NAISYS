-- Move assigned_to from order_runs to operation_runs (as FK to users)
ALTER TABLE "operation_runs" ADD COLUMN "assigned_to_id" INTEGER REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_runs" DROP COLUMN "assigned_to";
