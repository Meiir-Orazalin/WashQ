CREATE TABLE "wash_boxes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "wash_boxes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "wash_boxes_number_range" CHECK ("number" BETWEEN 1 AND 999)
);

CREATE UNIQUE INDEX "wash_boxes_branch_id_number_key" ON "wash_boxes"("branch_id", "number");
ALTER TABLE "wash_boxes" ADD CONSTRAINT "wash_boxes_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
