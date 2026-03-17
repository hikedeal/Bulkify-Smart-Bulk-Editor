-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CreateTable
CREATE TABLE "shop_settings" (
    "shop_domain" TEXT NOT NULL,
    "shop_name" TEXT,
    "contact_email" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_settings_pkey" PRIMARY KEY ("shop_domain")
);

-- CreateTable
CREATE TABLE "price_jobs" (
    "job_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "shop_domain" TEXT NOT NULL,
    "name" TEXT DEFAULT 'Untitled Task',
    "status" TEXT NOT NULL,
    "start_time" TIMESTAMP(6),
    "end_time" TIMESTAMP(6),
    "completed_at" TIMESTAMP(6),
    "configuration" JSONB DEFAULT '{}',
    "original_data" JSONB DEFAULT '{}',
    "total_products" INTEGER NOT NULL DEFAULT 0,
    "processed_products" INTEGER NOT NULL DEFAULT 0,
    "preview_json" JSONB DEFAULT '[]',
    "result_json" JSONB DEFAULT '[]',
    "error" TEXT,
    "note" TEXT,
    "scheduled_revert_at" TIMESTAMP(6),
    "reverted_at" TIMESTAMP(6),
    "revert_status" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_jobs_pkey" PRIMARY KEY ("job_id")
);

-- CreateTable
CREATE TABLE "job_config_price" (
    "config_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "job_id" UUID NOT NULL,
    "edit_method" TEXT NOT NULL,
    "edit_value" DECIMAL,
    "rounding_method" TEXT DEFAULT 'none',
    "rounding_value" TEXT,
    "compare_at_option" TEXT DEFAULT 'none',
    "compare_at_method" TEXT,
    "compare_at_value" DECIMAL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_config_price_pkey" PRIMARY KEY ("config_id")
);

-- CreateTable
CREATE TABLE "job_config_inventory" (
    "config_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "job_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_config_inventory_pkey" PRIMARY KEY ("config_id")
);

-- CreateTable
CREATE TABLE "job_config_cost" (
    "config_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "job_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "value" DECIMAL NOT NULL,
    "rounding_method" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_config_cost_pkey" PRIMARY KEY ("config_id")
);

-- CreateTable
CREATE TABLE "job_config_tags" (
    "config_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "job_id" UUID NOT NULL,
    "tags_to_add" TEXT[],
    "tags_to_remove" TEXT[],
    "method" TEXT DEFAULT 'append',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_config_tags_pkey" PRIMARY KEY ("config_id")
);

-- CreateTable
CREATE TABLE "job_config_status" (
    "config_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "job_id" UUID NOT NULL,
    "target_status" TEXT NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_config_status_pkey" PRIMARY KEY ("config_id")
);

-- CreateTable
CREATE TABLE "job_config_metafield" (
    "config_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "job_id" UUID NOT NULL,
    "namespace" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT,
    "value_type" TEXT DEFAULT 'single_line_text_field',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_config_metafield_pkey" PRIMARY KEY ("config_id")
);

-- CreateTable
CREATE TABLE "job_config_weight" (
    "config_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "job_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "value" DECIMAL NOT NULL,
    "unit" TEXT NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_config_weight_pkey" PRIMARY KEY ("config_id")
);

-- CreateTable
CREATE TABLE "job_config_vendor" (
    "config_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "job_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "find_text" TEXT,
    "replace_text" TEXT,
    "prefix_value" TEXT,
    "suffix_value" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_config_vendor_pkey" PRIMARY KEY ("config_id")
);

-- CreateTable
CREATE TABLE "job_config_product_type" (
    "config_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "job_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "find_text" TEXT,
    "replace_text" TEXT,
    "prefix_value" TEXT,
    "suffix_value" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_config_product_type_pkey" PRIMARY KEY ("config_id")
);

-- CreateTable
CREATE TABLE "job_config_shipping" (
    "config_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "job_id" UUID NOT NULL,
    "value" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_config_shipping_pkey" PRIMARY KEY ("config_id")
);

-- CreateTable
CREATE TABLE "job_config_taxable" (
    "config_id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "job_id" UUID NOT NULL,
    "value" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_config_taxable_pkey" PRIMARY KEY ("config_id")
);

-- CreateTable
CREATE TABLE "metafield_presets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shop_domain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metafield_presets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shops" (
    "shop" TEXT NOT NULL,
    "shop_name" TEXT,
    "email" TEXT,
    "plan" TEXT DEFAULT 'FREE',
    "plan_name" TEXT,
    "billing_status" TEXT DEFAULT 'INACTIVE',
    "billing_interval" TEXT,
    "plan_price" DECIMAL,
    "billing_price" DECIMAL,
    "subscription_id" TEXT,
    "billing_charge_id" TEXT,
    "discount_code" TEXT,
    "discount_amount" DECIMAL,
    "uninstalled_at" TIMESTAMP(6),
    "feature_flags" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shops_pkey" PRIMARY KEY ("shop")
);

-- CreateTable
CREATE TABLE "discount_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" DECIMAL NOT NULL,
    "applies_to" TEXT NOT NULL,
    "expires_at" TIMESTAMP(6),
    "max_redemptions" INTEGER,
    "redeemed_count" INTEGER DEFAULT 0,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_redemptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shop" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "redeemed_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shop" TEXT NOT NULL,
    "task_name" TEXT,
    "field" TEXT,
    "configuration" JSONB,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task_id" UUID,
    "job_id" UUID,
    "shop" TEXT,
    "status" TEXT,
    "total_items" INTEGER DEFAULT 0,
    "success_items" INTEGER DEFAULT 0,
    "failed_items" INTEGER DEFAULT 0,
    "total_products" INTEGER DEFAULT 0,
    "updated_products" INTEGER DEFAULT 0,
    "failed_products" INTEGER DEFAULT 0,
    "error_message" TEXT,
    "started_at" TIMESTAMP(6),
    "completed_at" TIMESTAMP(6),

    CONSTRAINT "task_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_run_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID,
    "shop" TEXT,
    "product_id" TEXT,
    "product_title" TEXT,
    "field_name" TEXT,
    "original_value" TEXT,
    "new_value" TEXT,
    "status" TEXT,
    "error_message" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_run_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shop_domain" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metafield_favorites" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shop" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metafield_favorites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metafield_recent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shop" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metafield_recent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demo_products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shop" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "task_id" UUID,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demo_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shop_domain" TEXT NOT NULL,
    "admin_email" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_price_jobs_shop_domain" ON "price_jobs"("shop_domain");

-- CreateIndex
CREATE INDEX "idx_price_jobs_scheduled_revert" ON "price_jobs"("scheduled_revert_at");

-- CreateIndex
CREATE INDEX "idx_price_jobs_status_start_time" ON "price_jobs"("status", "start_time");

-- CreateIndex
CREATE INDEX "idx_price_jobs_shop_created" ON "price_jobs"("shop_domain", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_job_price_job_id" ON "job_config_price"("job_id");

-- CreateIndex
CREATE INDEX "idx_job_inventory_job_id" ON "job_config_inventory"("job_id");

-- CreateIndex
CREATE INDEX "idx_job_cost_job_id" ON "job_config_cost"("job_id");

-- CreateIndex
CREATE INDEX "idx_job_tags_job_id" ON "job_config_tags"("job_id");

-- CreateIndex
CREATE INDEX "idx_job_status_job_id" ON "job_config_status"("job_id");

-- CreateIndex
CREATE INDEX "idx_job_metafield_job_id" ON "job_config_metafield"("job_id");

-- CreateIndex
CREATE INDEX "idx_job_weight_job_id" ON "job_config_weight"("job_id");

-- CreateIndex
CREATE INDEX "idx_job_vendor_job_id" ON "job_config_vendor"("job_id");

-- CreateIndex
CREATE INDEX "idx_job_product_type_job_id" ON "job_config_product_type"("job_id");

-- CreateIndex
CREATE INDEX "idx_job_shipping_job_id" ON "job_config_shipping"("job_id");

-- CreateIndex
CREATE INDEX "idx_job_taxable_job_id" ON "job_config_taxable"("job_id");

-- CreateIndex
CREATE INDEX "idx_metafield_presets_shop" ON "metafield_presets"("shop_domain");

-- CreateIndex
CREATE INDEX "idx_shops_plan" ON "shops"("plan");

-- CreateIndex
CREATE UNIQUE INDEX "discount_codes_code_key" ON "discount_codes"("code");

-- CreateIndex
CREATE INDEX "idx_tasks_shop" ON "tasks"("shop");

-- CreateIndex
CREATE INDEX "idx_task_runs_shop" ON "task_runs"("shop");

-- CreateIndex
CREATE INDEX "idx_task_runs_task_id" ON "task_runs"("task_id");

-- CreateIndex
CREATE INDEX "idx_task_runs_job_id" ON "task_runs"("job_id");

-- CreateIndex
CREATE INDEX "idx_task_run_items_run_id" ON "task_run_items"("run_id");

-- CreateIndex
CREATE INDEX "idx_app_events_shop_domain_created_at" ON "app_events"("shop_domain", "created_at");

-- CreateIndex
CREATE INDEX "idx_app_events_event_name_created_at" ON "app_events"("event_name", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "metafield_favorites_shop_target_namespace_key_key" ON "metafield_favorites"("shop", "target", "namespace", "key");

-- CreateIndex
CREATE UNIQUE INDEX "metafield_recent_shop_target_namespace_key_key" ON "metafield_recent"("shop", "target", "namespace", "key");

-- CreateIndex
CREATE INDEX "idx_admin_logs_shop_domain" ON "admin_logs"("shop_domain");

-- AddForeignKey
ALTER TABLE "job_config_price" ADD CONSTRAINT "job_config_price_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "price_jobs"("job_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_config_inventory" ADD CONSTRAINT "job_config_inventory_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "price_jobs"("job_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_config_cost" ADD CONSTRAINT "job_config_cost_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "price_jobs"("job_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_config_tags" ADD CONSTRAINT "job_config_tags_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "price_jobs"("job_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_config_status" ADD CONSTRAINT "job_config_status_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "price_jobs"("job_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_config_metafield" ADD CONSTRAINT "job_config_metafield_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "price_jobs"("job_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_config_weight" ADD CONSTRAINT "job_config_weight_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "price_jobs"("job_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_config_vendor" ADD CONSTRAINT "job_config_vendor_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "price_jobs"("job_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_config_product_type" ADD CONSTRAINT "job_config_product_type_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "price_jobs"("job_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_config_shipping" ADD CONSTRAINT "job_config_shipping_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "price_jobs"("job_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_config_taxable" ADD CONSTRAINT "job_config_taxable_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "price_jobs"("job_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_run_items" ADD CONSTRAINT "task_run_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "task_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_events" ADD CONSTRAINT "app_events_shop_domain_fkey" FOREIGN KEY ("shop_domain") REFERENCES "shops"("shop") ON DELETE CASCADE ON UPDATE CASCADE;
