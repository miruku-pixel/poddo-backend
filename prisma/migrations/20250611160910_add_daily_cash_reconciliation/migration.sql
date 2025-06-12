-- CreateTable
CREATE TABLE "daily_cash_reconciliation" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "report_date" TIMESTAMP(3) NOT NULL,
    "previousDayBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cashDeposit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dailyCashRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "remainingBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_cash_reconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_cash_reconciliation_report_date_idx" ON "daily_cash_reconciliation"("report_date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_cash_reconciliation_outletId_report_date_key" ON "daily_cash_reconciliation"("outletId", "report_date");

-- AddForeignKey
ALTER TABLE "daily_cash_reconciliation" ADD CONSTRAINT "daily_cash_reconciliation_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
