-- CreateTable
CREATE TABLE "branch_services" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "duration_minutes" INTEGER NOT NULL,
    "price_minor" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branch_services_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "branch_services"
    ADD CONSTRAINT "branch_services_duration_range" CHECK ("duration_minutes" BETWEEN 1 AND 1440),
    ADD CONSTRAINT "branch_services_price_range" CHECK ("price_minor" BETWEEN 1 AND 100000000),
    ADD CONSTRAINT "branch_services_currency_kzt" CHECK ("currency" = 'KZT');

-- CreateIndex
CREATE INDEX "branch_services_branch_id_created_at_id_idx" ON "branch_services"("branch_id", "created_at" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "branch_services" ADD CONSTRAINT "branch_services_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
