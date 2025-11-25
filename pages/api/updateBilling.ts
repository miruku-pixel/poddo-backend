import { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../lib/prisma";
import { PaymentStatus } from "@prisma/client";
import {
    withAuth,
    AuthenticatedRequest,
} from "../../middleware/authMiddleware";
import { corsMiddleware } from "../../middleware/cors";

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "PUT") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {
        const { orderId, paymentType, amountPaid, remark, discount } = req.body;
        const { user } = req as AuthenticatedRequest;

        if (!orderId || !paymentType || typeof amountPaid !== "number") {
            return res.status(400).json({ error: "Missing required fields" });
        }

        const updatedBilling = await prisma.$transaction(async (tx) => {
            // 1. Find the order and check status/type
            const order = await tx.order.findUnique({
                where: { id: orderId },
                include: { outlet: true, orderType: true },
            });

            if (!order) {
                throw new Error("Order not found");
            }

            const orderTypeName = order.orderType.name;

            // 2. Validate Order Type Restriction
            if (orderTypeName !== "Dine In" && orderTypeName !== "Take Away") {
                throw new Error(
                    "Billing update is only allowed for 'Dine In' or 'Take Away' orders."
                );
            }

            // 3. Find existing billing
            const existingBilling = await tx.billing.findUnique({
                where: { orderId: orderId },
            });

            if (!existingBilling) {
                throw new Error("Billing record not found for this order");
            }

            // 4. Recalculate Discount and Total
            let finalDiscountAmount = 0;
            const manualDiscountFromRequestBody = Number(discount) || 0;

            // Since we already validated it's Dine In or Take Away, we use manual discount
            finalDiscountAmount = manualDiscountFromRequestBody;

            // Ensure finalDiscountAmount is not negative
            finalDiscountAmount = Math.max(0, finalDiscountAmount);

            // Calculate the actual total after applying the determined discount
            const finalBillingTotal = order.total - finalDiscountAmount;

            // 5. Calculate change
            const changeGiven = amountPaid - finalBillingTotal;
            if (changeGiven < 0) {
                throw new Error("Insufficient payment");
            }

            const currentUTCDateTime = new Date(new Date().toISOString());

            // 6. Update Billing
            const billing = await tx.billing.update({
                where: { id: existingBilling.id },
                data: {
                    subtotal: order.subtotal, // Should be same, but good to ensure consistency
                    tax: 0, // hardcoded as per original billing logic
                    discount: finalDiscountAmount,
                    total: finalBillingTotal,
                    amountPaid,
                    changeGiven,
                    paymentType,
                    remark,
                    paidAt: currentUTCDateTime,
                    cashierId: user.id,
                    // status is likely already PAID, but we can reaffirm it.
                    status: PaymentStatus.PAID,
                },
                include: {
                    cashier: {
                        select: {
                            id: true,
                            username: true,
                        },
                    },
                },
            });

            return billing;
        });

        res.status(200).json(updatedBilling);
    } catch (err: any) {
        console.error("[Update Billing API Error]", err);

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
