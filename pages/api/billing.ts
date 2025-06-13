import { NextApiRequest, NextApiResponse } from "next";
import { PrismaClient, OrderStatus } from "@prisma/client";
import {
  withAuth,
  AuthenticatedRequest,
} from "../../middleware/authMiddleware";
import { corsMiddleware } from "../../middleware/cors";

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
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { outlet: true, orderType: true },
      // Ensure discount and tax fields are selected
    });

    if (!order) return res.status(404).json({ error: "Order not found" });
    if (
      order.status !== OrderStatus.SERVED &&
      order.status !== OrderStatus.PAID
    ) {
      return res.status(400).json({ error: "Order is not ready for billing" });
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
        return res.status(500).json({
          error:
            "Order is missing outletId or orderTypeId for discount calculation.",
        });
      }

      const orderTypeDiscount = await prisma.orderTypeDiscount.findUnique({
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
      return res.status(400).json({ error: "Insufficient payment" });
    }

    // Lock the counter row for update
    const counter = await prisma.receiptNumberCounter.upsert({
      where: { outletId: order.outletId },
      update: { current: { increment: 1 } },
      create: { outletId: order.outletId, current: 1 },
    });

    // Generate order number string (e.g., "ORD-00123" or just "123")
    const receiptNumber = counter.current.toString().padStart(5, "0");

    const currentUTCDateTime = new Date(new Date().toISOString());

    // 4. Create Billing record
    const billing = await prisma.billing.create({
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
    await prisma.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.PAID },
    });

    res.status(201).json(billing);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
}

// Next.js API route: /api/billing/pay
// Helper to apply middlewares in sequence
function applyMiddleware(handler: any, middlewares: any[]) {
  return middlewares.reduceRight((next, mw) => mw(next), handler);
}

export default applyMiddleware(handler, [corsMiddleware, withAuth]);
