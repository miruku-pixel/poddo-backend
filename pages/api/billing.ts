import { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../lib/prisma";
import { OrderStatus, PaymentStatus } from "@prisma/client";
import {
  withAuth,
  AuthenticatedRequest,
} from "../../middleware/authMiddleware";
import { corsMiddleware } from "../../middleware/cors";
import { deductIngredientsForPaidOrder } from "../../lib/inventoryActions";

//const prisma = new PrismaClient();

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

      // --- DISCOUNT CALCULATION LOGIC ---
      let finalDiscountAmount = 0;
      const orderTypeName = order.orderType.name;

      const manualDiscountFromRequestBody = Number(discount) || 0;

      if (orderTypeName === "Dine In" || orderTypeName === "Take Away") {
        finalDiscountAmount = manualDiscountFromRequestBody;
      } else {
        if (!order.outletId || !order.orderTypeId) {
          throw new Error(
            "Order is missing outletId or orderTypeId for discount calculation."
          );
        }

        const orderTypeDiscount = await tx.orderTypeDiscount.findUnique({
          where: {
            orderTypeId_outletId: {
              orderTypeId: order.orderTypeId,
              outletId: order.outletId,
            },
          },
          select: { percentage: true, isActive: true },
        });

        if (orderTypeDiscount?.isActive && orderTypeDiscount.percentage > 0) {
          finalDiscountAmount = order.total * orderTypeDiscount.percentage;
        } else {
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

      const counter = await tx.receiptNumberCounter.upsert({
        where: { outletId: order.outletId },
        update: { current: { increment: 1 } },
        create: { outletId: order.outletId, current: 1 },
      });

      const receiptNumber = counter.current.toString().padStart(5, "0");

      const currentUTCDateTime = new Date(new Date().toISOString());

      const billing = await tx.billing.create({
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
          status: PaymentStatus.PAID,
          cashierId,
          receiptNumber,
          remark,
          paidAt: currentUTCDateTime, // FIX: Set paidAt explicitly to current UTC time
          createdAt: currentUTCDateTime,
        },
        include: {
          cashier: {
            select: {
              id: true,
              username: true, // or whatever field your User model has for display
            },
          },
        },
      });

      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.PAID },
      });

      await deductIngredientsForPaidOrder(order.id, order.outletId, tx);

      return billing;
    });

    res.status(201).json(billingResult);
  } catch (err: any) {
    console.error("[Billing API Error]", err);

    if (err.message) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: "Internal server error" });
  }
}

function applyMiddleware(handler: any, middlewares: any[]) {
  return middlewares.reduceRight((next, mw) => mw(next), handler);
}

export default applyMiddleware(handler, [corsMiddleware, withAuth]);
