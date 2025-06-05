-- CreateTable
CREATE TABLE "OutletAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,

    CONSTRAINT "OutletAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutletAccess_userId_outletId_key" ON "OutletAccess"("userId", "outletId");

-- AddForeignKey
ALTER TABLE "OutletAccess" ADD CONSTRAINT "OutletAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletAccess" ADD CONSTRAINT "OutletAccess_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
