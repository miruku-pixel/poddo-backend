import { NextApiRequest, NextApiResponse } from "next";
import { PrismaClient, OrderStatus } from "@prisma/client";
import {
  withAuth,
  AuthenticatedRequest,
} from "../../middleware/authMiddleware";
import { corsMiddleware } from "../../middleware/cors";
import { deductIngredientsForPaidOrder } from "../../lib/inventoryActions";

const prisma = new PrismaClient();

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { orderId, paymentType, amountPaid, remark, discount } = req.body;
    const { user } = req as AuthenticatedRequest;
    const cashierId = user.id;

    if (!orderId || !paymentType || typeof amountPaid !== "number") {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // 1. Find the order and check status
    const billingResult = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { outlet: true, orderType: true },
        // Ensure discount and tax fields are selected
      });

      if (!order) {
        // If order not found, throw an error to rollback the transaction
        throw new Error("Order not found");
      }
      if (
        order.status !== OrderStatus.SERVED &&
        order.status !== OrderStatus.PAID // Allow re-billing if already paid (e.g., partial payment adjustments)
      ) {
        throw new Error("Order is not ready for billing");
      }
      // --- DISCOUNT CALCULATION LOGIC ---
      let finalDiscountAmount = 0;
      const orderTypeName = order.orderType.name;

      const manualDiscountFromRequestBody = Number(discount) || 0;

      // Logic: Only Dine In and Take Away will use the discount from req.body.
      if (orderTypeName === "Dine In" || orderTypeName === "Take Away") {
        finalDiscountAmount = manualDiscountFromRequestBody;
      } else {
        // For other order types (e.g., Gojek, Grab), fetch discount from OrderTypeDiscount table
        // Ensure order.outletId and order.orderTypeId are available
        if (!order.outletId || !order.orderTypeId) {
          throw new Error(
            "Order is missing outletId or orderTypeId for discount calculation."
          );
        }

        const orderTypeDiscount = await tx.orderTypeDiscount.findUnique({
          // Use tx
          where: {
            orderTypeId_outletId: {
              // Use the compound unique key
              orderTypeId: order.orderTypeId,
              outletId: order.outletId,
            },
          },
          select: { percentage: true, isActive: true },
        });

        if (orderTypeDiscount?.isActive && orderTypeDiscount.percentage > 0) {
          // Calculate percentage-based discount from the order's total
          finalDiscountAmount = order.total * orderTypeDiscount.percentage;
          // If you want to combine with manual discount, add it here:
          // finalDiscountAmount += manualDiscountFromRequestBody; // Uncomment if manual + backend discount is allowed for these types
        } else {
          // If no active backend discount found for this order type/outlet,
          // or percentage is 0, use the manual discount from the request body as a fallback
          finalDiscountAmount = manualDiscountFromRequestBody;
        }
      }

      // Ensure finalDiscountAmount is not negative
      finalDiscountAmount = Math.max(0, finalDiscountAmount);

      // Calculate the actual total after applying the determined discount
      const finalBillingTotal = order.total - finalDiscountAmount;

      // 2. Calculate change
      const changeGiven = amountPaid - finalBillingTotal;
      if (changeGiven < 0) {
        throw new Error("Insufficient payment"); // Throw to rollback
      }

      // Lock the counter row for update
      const counter = await tx.receiptNumberCounter.upsert({
        // Use tx
        where: { outletId: order.outletId },
        update: { current: { increment: 1 } },
        create: { outletId: order.outletId, current: 1 },
      });
      // Generate order number string (e.g., "ORD-00123" or just "123")
      const receiptNumber = counter.current.toString().padStart(5, "0");

      const currentUTCDateTime = new Date(new Date().toISOString());

      // 4. Create Billing record
      const billing = await tx.billing.create({
        // Use tx
        data: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          outletId: order.outletId,
          subtotal: order.subtotal,
          tax: 0, // hardcoded as per your requirement
          discount: finalDiscountAmount, // from payload, fallback to 0
          total: finalBillingTotal,
          amountPaid,
          changeGiven,
          paymentType,
          cashierId,
          receiptNumber,
          remark,
          paidAt: currentUTCDateTime, // FIX: Set paidAt explicitly to current UTC time
          createdAt: currentUTCDateTime,
        },
      });

      // 5. Update order status to PAID
      await tx.order.update({
        // Use tx
        where: { id: order.id },
        data: { status: OrderStatus.PAID },
      });

      // 6. **Call stock deduction logic after order is successfully marked as PAID**
      // Pass the transaction client (tx) to ensure it's part of the same transaction
      await deductIngredientsForPaidOrder(order.id, order.outletId, tx);

      return billing; // Return the billing object from the transaction
    });

    res.status(201).json(billingResult);
  } catch (err: any) {
    console.error("[Billing API Error]", err);
    // Return a more specific error message if it's a known error type
    if (err.message) {
      return res.status(400).json({ error: err.message }); // Send back the error message from throws
    }
    res.status(500).json({ error: "Internal server error" });
  }
}

// Next.js API route: /api/billing/pay
// Helper to apply middlewares in sequence
function applyMiddleware(handler: any, middlewares: any[]) {
  return middlewares.reduceRight((next, mw) => mw(next), handler);
}

export default applyMiddleware(handler, [corsMiddleware, withAuth]);
