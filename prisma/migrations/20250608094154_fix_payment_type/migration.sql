/*
  Warnings:

  - The values [SHOPPEFOOD] on the enum `PaymentType` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "PaymentType_new" AS ENUM ('CASH', 'QRIS', 'BANK_TRANSFER', 'KASBON', 'GRABFOOD', 'SHOPEEFOOD', 'GOFOOD');
ALTER TABLE "Billing" ALTER COLUMN "paymentType" TYPE "PaymentType_new" USING ("paymentType"::text::"PaymentType_new");
ALTER TYPE "PaymentType" RENAME TO "PaymentType_old";
ALTER TYPE "PaymentType_new" RENAME TO "PaymentType";
DROP TYPE "PaymentType_old";
COMMIT;
