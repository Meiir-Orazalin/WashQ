-- CreateEnum
CREATE TYPE "branch_weekday" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateEnum
CREATE TYPE "branch_opening_status" AS ENUM ('CLOSED', 'OPEN', 'OPEN_24_HOURS');

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "address_line" VARCHAR(250) NOT NULL,
    "time_zone" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_opening_hours" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "day_of_week" "branch_weekday" NOT NULL,
    "status" "branch_opening_status" NOT NULL,
    "opens_at_minute" INTEGER,
    "closes_at_minute" INTEGER,
    "closes_next_day" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branch_opening_hours_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "branches_organization_id_created_at_id_idx" ON "branches"("organization_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "branch_opening_hours_branch_id_day_of_week_key" ON "branch_opening_hours"("branch_id", "day_of_week");

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_opening_hours" ADD CONSTRAINT "branch_opening_hours_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Recurring local wall-clock minutes, never UTC instants.
ALTER TABLE "branch_opening_hours" ADD CONSTRAINT "opening_minutes_range" CHECK (
  (opens_at_minute IS NULL OR opens_at_minute BETWEEN 0 AND 1439) AND
  (closes_at_minute IS NULL OR closes_at_minute BETWEEN 0 AND 1439)
);
ALTER TABLE "branch_opening_hours" ADD CONSTRAINT "opening_status_interval" CHECK (
  (status IN ('CLOSED', 'OPEN_24_HOURS') AND opens_at_minute IS NULL AND closes_at_minute IS NULL AND closes_next_day = false) OR
  (status = 'OPEN' AND opens_at_minute IS NOT NULL AND closes_at_minute IS NOT NULL AND
   closes_at_minute + CASE WHEN closes_next_day THEN 1440 ELSE 0 END - opens_at_minute BETWEEN 1 AND 1439)
);
