/*
  Warnings:

  - A unique constraint covering the columns `[number,entityId]` on the table `DiningTable` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[name,entityId]` on the table `Food` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `entityId` to the `DiningTable` table without a default value. This is not possible if the table is not empty.
  - Added the required column `entityId` to the `Food` table without a default value. This is not possible if the table is not empty.
  - Added the required column `entityId` to the `Order` table without a default value. This is not possible if the table is not empty.
  - Added the required column `entityId` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "DiningTable_number_key";

-- DropIndex
DROP INDEX "Food_name_key";

-- AlterTable
ALTER TABLE "DiningTable" ADD COLUMN     "entityId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Food" ADD COLUMN     "entityId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "entityId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "entityId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "Entity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Entity_name_key" ON "Entity"("name");

-- CreateIndex
CREATE UNIQUE INDEX "DiningTable_number_entityId_key" ON "DiningTable"("number", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Food_name_entityId_key" ON "Food"("name", "entityId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Food" ADD CONSTRAINT "Food_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiningTable" ADD CONSTRAINT "DiningTable_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
