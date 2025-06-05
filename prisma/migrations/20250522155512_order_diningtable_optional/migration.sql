-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_diningTableId_fkey";

-- AlterTable
ALTER TABLE "Order" ALTER COLUMN "diningTableId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_diningTableId_fkey" FOREIGN KEY ("diningTableId") REFERENCES "DiningTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
