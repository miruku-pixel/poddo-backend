/*
  Warnings:

  - A unique constraint covering the columns `[outletId,receiptNumber]` on the table `Billing` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[outletId,orderNumber]` on the table `Order` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Billing_receiptNumber_key";

-- DropIndex
DROP INDEX "Order_orderNumber_key";

-- CreateIndex
CREATE UNIQUE INDEX "Billing_outletId_receiptNumber_key" ON "Billing"("outletId", "receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Order_outletId_orderNumber_key" ON "Order"("outletId", "orderNumber");
