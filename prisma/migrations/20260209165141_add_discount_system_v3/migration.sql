/*
  Warnings:

  - You are about to drop the column `max_redemptions` on the `discount_codes` table. All the data in the column will be lost.
  - You are about to drop the column `redeemed_count` on the `discount_codes` table. All the data in the column will be lost.
  - You are about to drop the column `code` on the `discount_redemptions` table. All the data in the column will be lost.
  - You are about to drop the column `interval` on the `discount_redemptions` table. All the data in the column will be lost.
  - You are about to drop the column `shop` on the `discount_redemptions` table. All the data in the column will be lost.
  - Made the column `is_active` on table `discount_codes` required. This step will fail if there are existing NULL values in that column.
  - Made the column `created_at` on table `discount_codes` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `discount_code_id` to the `discount_redemptions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `discounted_price_cents` to the `discount_redemptions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `original_price_cents` to the `discount_redemptions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `plan_interval` to the `discount_redemptions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `shop_id` to the `discount_redemptions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "discount_codes" DROP COLUMN "max_redemptions",
DROP COLUMN "redeemed_count",
ADD COLUMN     "created_by_shop" TEXT,
ADD COLUMN     "max_uses" INTEGER,
ADD COLUMN     "used_count" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "is_active" SET NOT NULL,
ALTER COLUMN "created_at" SET NOT NULL;

-- AlterTable
ALTER TABLE "discount_redemptions" DROP COLUMN "code",
DROP COLUMN "interval",
DROP COLUMN "shop",
ADD COLUMN     "discount_code_id" UUID NOT NULL,
ADD COLUMN     "discounted_price_cents" INTEGER NOT NULL,
ADD COLUMN     "original_price_cents" INTEGER NOT NULL,
ADD COLUMN     "plan_interval" TEXT NOT NULL,
ADD COLUMN     "shop_id" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "idx_discount_redemptions_shop" ON "discount_redemptions"("shop_id");

-- CreateIndex
CREATE INDEX "idx_discount_redemptions_code_id" ON "discount_redemptions"("discount_code_id");

-- AddForeignKey
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_discount_code_id_fkey" FOREIGN KEY ("discount_code_id") REFERENCES "discount_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
