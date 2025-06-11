-- CreateTable
CREATE TABLE "ReceiptNumberCounter" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "current" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptNumberCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptNumberCounter_outletId_key" ON "ReceiptNumberCounter"("outletId");

-- AddForeignKey
ALTER TABLE "ReceiptNumberCounter" ADD CONSTRAINT "ReceiptNumberCounter_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
