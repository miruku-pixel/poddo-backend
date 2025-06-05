-- CreateTable
CREATE TABLE "OrderTypeDiscount" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "orderTypeId" TEXT NOT NULL,
    "percentage" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderTypeDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderTypeDiscount_orderTypeId_outletId_key" ON "OrderTypeDiscount"("orderTypeId", "outletId");

-- AddForeignKey
ALTER TABLE "OrderTypeDiscount" ADD CONSTRAINT "OrderTypeDiscount_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTypeDiscount" ADD CONSTRAINT "OrderTypeDiscount_orderTypeId_fkey" FOREIGN KEY ("orderTypeId") REFERENCES "OrderType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
