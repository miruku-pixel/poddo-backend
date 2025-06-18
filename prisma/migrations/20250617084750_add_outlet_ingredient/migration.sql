/*
  Warnings:

  - Added the required column `outletId` to the `IngredientStockLog` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "IngredientStockLog" ADD COLUMN     "outletId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "IngredientStockLog" ADD CONSTRAINT "IngredientStockLog_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
