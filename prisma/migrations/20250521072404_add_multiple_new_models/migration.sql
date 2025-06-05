/*
  Warnings:

  - You are about to drop the column `entityId` on the `Billing` table. All the data in the column will be lost.
  - You are about to drop the column `entityId` on the `DiningTable` table. All the data in the column will be lost.
  - You are about to drop the column `entityId` on the `Food` table. All the data in the column will be lost.
  - You are about to drop the column `price` on the `Food` table. All the data in the column will be lost.
  - You are about to drop the column `entityId` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `entityId` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `Entity` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[number,outletId]` on the table `DiningTable` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[name,outletId]` on the table `Food` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `outletId` to the `Billing` table without a default value. This is not possible if the table is not empty.
  - Added the required column `outletId` to the `DiningTable` table without a default value. This is not possible if the table is not empty.
  - Added the required column `outletId` to the `Food` table without a default value. This is not possible if the table is not empty.
  - Added the required column `orderTypeId` to the `Order` table without a default value. This is not possible if the table is not empty.
  - Added the required column `outletId` to the `Order` table without a default value. This is not possible if the table is not empty.
  - Added the required column `outletId` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Role" ADD VALUE 'SUPERUSER';
ALTER TYPE "Role" ADD VALUE 'OWNER';

-- DropForeignKey
ALTER TABLE "Billing" DROP CONSTRAINT "Billing_entityId_fkey";

-- DropForeignKey
ALTER TABLE "DiningTable" DROP CONSTRAINT "DiningTable_entityId_fkey";

-- DropForeignKey
ALTER TABLE "Food" DROP CONSTRAINT "Food_entityId_fkey";

-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_entityId_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_entityId_fkey";

-- DropIndex
DROP INDEX "DiningTable_number_entityId_key";

-- DropIndex
DROP INDEX "Food_name_entityId_key";

-- AlterTable
ALTER TABLE "Billing" DROP COLUMN "entityId",
ADD COLUMN     "outletId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "DiningTable" DROP COLUMN "entityId",
ADD COLUMN     "outletId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Food" DROP COLUMN "entityId",
DROP COLUMN "price",
ADD COLUMN     "foodCategoryId" TEXT,
ADD COLUMN     "outletId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "entityId",
ADD COLUMN     "orderTypeId" TEXT NOT NULL,
ADD COLUMN     "outletId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "entityId",
ADD COLUMN     "outletId" TEXT NOT NULL;

-- DropTable
DROP TABLE "Entity";

-- CreateTable
CREATE TABLE "Outlet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "addressLine" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "contactName" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Outlet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "FoodCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodPrice" (
    "id" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,
    "orderTypeId" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "FoodPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "OrderType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Outlet_name_key" ON "Outlet"("name");

-- CreateIndex
CREATE UNIQUE INDEX "FoodCategory_name_key" ON "FoodCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "FoodPrice_foodId_orderTypeId_key" ON "FoodPrice"("foodId", "orderTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderType_name_key" ON "OrderType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "DiningTable_number_outletId_key" ON "DiningTable"("number", "outletId");

-- CreateIndex
CREATE UNIQUE INDEX "Food_name_outletId_key" ON "Food"("name", "outletId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Food" ADD CONSTRAINT "Food_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Food" ADD CONSTRAINT "Food_foodCategoryId_fkey" FOREIGN KEY ("foodCategoryId") REFERENCES "FoodCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodPrice" ADD CONSTRAINT "FoodPrice_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "Food"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodPrice" ADD CONSTRAINT "FoodPrice_orderTypeId_fkey" FOREIGN KEY ("orderTypeId") REFERENCES "OrderType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiningTable" ADD CONSTRAINT "DiningTable_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_orderTypeId_fkey" FOREIGN KEY ("orderTypeId") REFERENCES "OrderType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Billing" ADD CONSTRAINT "Billing_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
