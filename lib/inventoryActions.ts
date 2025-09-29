import {
  PrismaClient,
  StockLogType,
  OrderStatus,
  OrderItemStatus,
  Prisma,
} from "@prisma/client";

/**
 * Deducts ingredients from stock and logs the outbound transaction when an order is paid.
 * This function is designed to be called within an existing Prisma transaction.
 *
 * @param orderId The ID of the order that has been paid.
 * @param outletId The ID of the outlet where the order was placed (and where stock is deducted).
 * @param tx The Prisma TransactionClient instance to ensure atomicity with the parent transaction.
 */
export async function deductIngredientsForPaidOrder(
  orderId: string,
  outletId: string,
  tx: Prisma.TransactionClient
) {
  console.log(
    `[Inventory] Attempting to deduct ingredients for order: ${orderId} at outlet: ${outletId}`
  );

  try {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        orderType: {
          select: {
            name: true,
          },
        },
        items: {
          where: {
            status: OrderItemStatus.ACTIVE,
          },
          include: {
            food: {
              include: {
                FoodIngredient: {
                  include: {
                    ingredient: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!order) {
      console.warn(
        `[Inventory] Order with ID ${orderId} not found. Deduction skipped.`
      );
      throw new Error(
        `Order with ID ${orderId} not found. Cannot proceed with ingredient deduction.`
      );
    }

    if (order.status !== OrderStatus.PAID) {
      console.warn(
        `[Inventory] Order ${orderId} status is ${order.status}, not PAID. Deduction skipped.`
      );
      throw new Error(
        `Order ${orderId} status is not PAID. Cannot deduct ingredients.`
      );
    }

    // Ensure the order's outletId matches the provided outletId, as a safety check
    if (order.outletId !== outletId) {
      console.error(
        `[Inventory] Mismatch: Order ${order.id} belongs to outlet ${order.outletId}, but deduction requested for ${outletId}.`
      );
      throw new Error(
        `Order ${order.id} outlet mismatch. Cannot deduct ingredients.`
      );
    }

    // Determine the specific StockLogType for this order's outbound transaction
    let outboundLogType: StockLogType;
    if (order.orderType.name === "Boss") {
      outboundLogType = StockLogType.OUTBOUND_BOSS;
    } else if (order.orderType.name === "Staff") {
      outboundLogType = StockLogType.OUTBOUND_STAFF;
    } else {
      outboundLogType = StockLogType.OUTBOUND_NM; // Non-Manager / Normal Sales
    }
    console.log(
      `[Inventory] Determined StockLogType for order ${orderId}: ${outboundLogType}`
    );

    // Keep track of total deductions per ingredient
    const ingredientDeductions: Map<string, number> = new Map();

    // 2. Iterate through each ACTIVE order item to identify ingredients and quantities to deduct
    for (const orderItem of order.items) {
      // This `order.items` now only contains ACTIVE items due to the 'where' clause above
      const food = orderItem.food;
      const foodQuantitySold = orderItem.quantity;

      if (!food || food.FoodIngredient.length === 0) {
        console.warn(
          `[Inventory] Food '${food?.name || "Unknown"}' (ID: ${
            orderItem.foodId
          }) has no ingredients linked. Skipping deduction for this item.`
        );
        continue;
      }

      for (const foodIngredient of food.FoodIngredient) {
        const ingredientId = foodIngredient.ingredientId;
        const quantityPerFoodUnit = foodIngredient.quantity;

        const totalDeductionForIngredient =
          quantityPerFoodUnit * foodQuantitySold;

        ingredientDeductions.set(
          ingredientId,
          (ingredientDeductions.get(ingredientId) || 0) +
            totalDeductionForIngredient
        );
      }
    }

    // 3. Perform atomic stock updates and log each deduction
    for (const [
      ingredientId,
      totalDeduction,
    ] of ingredientDeductions.entries()) {
      const currentIngredient = await tx.ingredient.findUnique({
        where: { id: ingredientId },
        select: { stockQty: true, name: true },
      });

      if (!currentIngredient) {
        console.error(
          `[Inventory] Ingredient ID ${ingredientId} not found during deduction for order ${orderId}. Skipping.`
        );
        throw new Error(
          `Ingredient with ID ${ingredientId} not found. Cannot deduct stock for order ${orderId}.`
        );
      }

      if (currentIngredient.stockQty < totalDeduction) {
        console.warn(
          `[Inventory] Insufficient stock for '${currentIngredient.name}' (ID: ${ingredientId}) to fulfill order ${orderId}. Current: ${currentIngredient.stockQty}, Needed: ${totalDeduction}. Deduction will result in negative stock.`
        );
        throw new Error(
          `Insufficient stock for ${currentIngredient.name}. Cannot deduct ${totalDeduction} units.`
        );
      }

      // Deduct from Ingredient's stockQty
      // NOTE: This updates the GLOBAL stockQty on the Ingredient model.
      // As discussed, for a truly isolated per-outlet stock, you'd update an
      // 'OutletIngredientStock' model instead. This API assumes the Ingredient's
      // stockQty is a global aggregate, and logs are per-outlet.
      await tx.ingredient.update({
        where: { id: ingredientId },
        data: {
          stockQty: {
            decrement: totalDeduction,
          },
          updatedAt: new Date(), // Update ingredient's updated timestamp
        },
      });

      // Log the stock outbound with the determined type and outletId
      await tx.ingredientStockLog.create({
        data: {
          ingredientId: ingredientId,
          outletId: outletId, // <-- Use the passed outletId here
          orderId: orderId,
          quantity: totalDeduction,
          type: outboundLogType, // Use the dynamically determined type
          note: `Deducted for order ${order.orderNumber} (Type: ${order.orderType.name})`,
          transactionDate: order.createdAt, // Use the original order creation date for transactionDate
          createdAt: new Date(), // Timestamp when this log entry was created
        },
      });
      console.log(
        `[Inventory] Deducted ${totalDeduction} of Ingredient '${currentIngredient.name}' (ID: ${ingredientId}) for order ${orderId} (Type: ${outboundLogType}) at Outlet ${outletId}.`
      );
    }

    console.log(
      `[Inventory] Successfully processed ingredient deductions for order: ${orderId}`
    );
  } catch (error) {
    console.error(
      `[Inventory] Error deducting ingredients for order ${orderId}:`,
      error
    );
    throw error;
  }
}
