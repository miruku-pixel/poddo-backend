-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PAID', 'VOID');

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'VOID';

-- AlterEnum
ALTER TYPE "StockLogType" ADD VALUE 'VOID';

-- AlterTable
ALTER TABLE "Billing" ADD COLUMN     "status" "PaymentStatus" NOT NULL DEFAULT 'PAID';

-- AlterTable
ALTER TABLE "IngredientStockLog" ADD COLUMN     "orderId" TEXT;

-- AddForeignKey
ALTER TABLE "IngredientStockLog" ADD CONSTRAINT "IngredientStockLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
