/*
  Warnings:

  - A unique constraint covering the columns `[name,foodId]` on the table `FoodOption` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "FoodOption_name_foodId_key" ON "FoodOption"("name", "foodId");
