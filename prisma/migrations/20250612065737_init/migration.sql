-- AlterTable
ALTER TABLE "FoodOption" ADD COLUMN     "foodOptionCategoryId" TEXT;

-- CreateTable
CREATE TABLE "FoodOptionCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "selectionType" TEXT NOT NULL,
    "minSelections" INTEGER NOT NULL DEFAULT 0,
    "maxSelections" INTEGER,
    "quantityRule" TEXT NOT NULL DEFAULT 'NONE',

    CONSTRAINT "FoodOptionCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FoodOptionCategory_name_key" ON "FoodOptionCategory"("name");

-- AddForeignKey
ALTER TABLE "FoodOption" ADD CONSTRAINT "FoodOption_foodOptionCategoryId_fkey" FOREIGN KEY ("foodOptionCategoryId") REFERENCES "FoodOptionCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
