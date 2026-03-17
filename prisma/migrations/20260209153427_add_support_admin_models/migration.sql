-- CreateTable
CREATE TABLE "support_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shop_domain" TEXT NOT NULL,
    "issue_text" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'Medium',
    "follow_up_date" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_actions_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shop_domain" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "action_payload" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_actions_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "shop_domain" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "payload_json" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_support_notes_shop" ON "support_notes"("shop_domain");

-- CreateIndex
CREATE INDEX "idx_admin_actions_log_shop" ON "admin_actions_log"("shop_domain");

-- CreateIndex
CREATE INDEX "idx_task_logs_job" ON "task_logs"("job_id");

-- CreateIndex
CREATE INDEX "idx_task_logs_shop" ON "task_logs"("shop_domain");
