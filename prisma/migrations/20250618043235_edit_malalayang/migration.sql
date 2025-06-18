/*
  Warnings:

  - The values [TRANSFER_MALALAYNG] on the enum `StockLogType` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "StockLogType_new" AS ENUM ('INBOUND', 'DISCREPANCY', 'OUTBOUND_NM', 'OUTBOUND_BOSS', 'OUTBOUND_STAFF', 'TRANSFER_NAGOYA', 'TRANSFER_SERAYA', 'TRANSFER_BENGKONG', 'TRANSFER_MALALAYANG', 'TRANSFER_KLEAK', 'TRANSFER_PANIKI', 'TRANSFER_ITC');
ALTER TABLE "IngredientStockLog" ALTER COLUMN "type" TYPE "StockLogType_new" USING ("type"::text::"StockLogType_new");
ALTER TYPE "StockLogType" RENAME TO "StockLogType_old";
ALTER TYPE "StockLogType_new" RENAME TO "StockLogType";
DROP TYPE "StockLogType_old";
COMMIT;
