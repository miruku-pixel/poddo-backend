/*
  Warnings:

  - You are about to drop the column `groupId` on the `FoodOption` table. All the data in the column will be lost.
  - You are about to drop the `FoodOptionGroup` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `foodId` to the `FoodOption` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "FoodOption" DROP CONSTRAINT "FoodOption_groupId_fkey";

-- DropForeignKey
ALTER TABLE "FoodOptionGroup" DROP CONSTRAINT "FoodOptionGroup_foodId_fkey";

-- AlterTable
ALTER TABLE "FoodOption" DROP COLUMN "groupId",
ADD COLUMN     "foodId" TEXT NOT NULL;

-- DropTable
DROP TABLE "FoodOptionGroup";

-- AddForeignKey
ALTER TABLE "FoodOption" ADD CONSTRAINT "FoodOption_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "Food"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
