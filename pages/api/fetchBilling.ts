import { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../lib/prisma";
import { withAuth } from "../../middleware/authMiddleware";
import { corsMiddleware } from "../../middleware/cors";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // 1. Enforce GET method
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 2. Get required query parameters
  const { receiptNumber, outletId } = req.query;

  // 3. Validation
  if (!receiptNumber || typeof receiptNumber !== "string") {
    return res.status(400).json({ error: "Receipt number is required" });
  }
  if (!outletId || typeof outletId !== "string") {
    return res.status(400).json({ error: "Outlet ID is required" });
  }

  try {
    // 4. Fetch the Billing record using the unique compound key
    const billingRecord = await prisma.billing.findUnique({
      where: {
        outletId_receiptNumber: {
          outletId: outletId,
          receiptNumber: receiptNumber,
        },
      },
      // 5. Use nested include to fetch Order and its associated data
      include: {
        order: {
          include: {
            orderType: true,
            waiter: {
              select: { id: true, username: true },
            },
            items: {
              select: {
                quantity: true,
                unitPrice: true,
                totalPrice: true,
                food: {
                  select: { id: true, name: true },
                },
                options: {
                  include: {
                    option: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!billingRecord) {
      return res.status(404).json({
        error: "Billing record not found for this receipt and outlet.",
      });
    }

    // **SUCCESSFUL RESPONSE:** Send the raw, nested Prisma result
    res.status(200).json(billingRecord);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
}

function applyMiddleware(handler: any, middlewares: any[]) {
  return middlewares.reduceRight((next, mw) => mw(next), handler);
}

export default applyMiddleware(handler, [corsMiddleware, withAuth]);
