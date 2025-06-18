/*
  Warnings:

  - Added the required column `outletId` to the `Ingredient` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockLogType" ADD VALUE 'TRANSFER_NAGOYA';
ALTER TYPE "StockLogType" ADD VALUE 'TRANSFER_SERAYA';
ALTER TYPE "StockLogType" ADD VALUE 'TRANSFER_BENGKONG';
ALTER TYPE "StockLogType" ADD VALUE 'TRANSFER_MALALAYNG';
ALTER TYPE "StockLogType" ADD VALUE 'TRANSFER_KLEAK';
ALTER TYPE "StockLogType" ADD VALUE 'TRANSFER_PANIKI';
ALTER TYPE "StockLogType" ADD VALUE 'TRANSFER_ITC';

-- DropIndex
DROP INDEX "Ingredient_name_key";

-- AlterTable
ALTER TABLE "Ingredient" ADD COLUMN     "outletId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "Ingredient" ADD CONSTRAINT "Ingredient_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
