import { NextApiRequest, NextApiResponse } from "next";
import { PrismaClient, OrderStatus } from "@prisma/client";
import {
  withAuth,
  AuthenticatedRequest,
} from "../../middleware/authMiddleware";
import { corsMiddleware } from "../../middleware/cors";

const prisma = new PrismaClient();
const validStatuses = Object.values(OrderStatus);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "PATCH") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { orderId, status } = req.body;
  const user = (req as AuthenticatedRequest).user;

  // Manual validation
  if (!orderId || typeof orderId !== "string") {
    return res.status(400).json({ error: "Invalid or missing orderId" });
  }
  if (!status || !validStatuses.includes(status)) {
    return res
      .status(400)
      .json({ error: `Status must be one of: ${validStatuses.join(", ")}` });
  }

  try {
    // Find the order
    const existingOrder = await prisma.order.findUnique({
      where: { id: orderId },
      include: { waiter: true },
    });

    if (!existingOrder) {
      return res
        .status(404)
        .json({ error: `Order with ID ${orderId} not found` });
    }

    // --- Authorization Logic ---
    const userRole = user?.role;

    if (userRole) {
      if (userRole === "WAITER") {
        if (existingOrder.waiterId !== user?.id) {
          return res.status(403).json({
            error:
              "Forbidden: Waiters can only update their own assigned orders.",
          });
        }
      } else if (userRole !== "ADMIN" && userRole !== "CASHIER") {
        return res.status(403).json({
          error:
            "Forbidden: You do not have permission to update order status.",
        });
      }
    } else {
      return res
        .status(403)
        .json({ error: "Forbidden: User role not identified." });
    }

    // Update the order status
    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: { status: status as OrderStatus },
    });

    res.json(updatedOrder);
  } catch (error) {
    console.error("Error updating order status:", error);
    res.status(500).json({ error: "Failed to update order status" });
  } finally {
    await prisma.$disconnect();
  }
}

function applyMiddleware(handler: any, middlewares: any[]) {
  return middlewares.reduceRight((next, mw) => mw(next), handler);
}

export default applyMiddleware(handler, [corsMiddleware, withAuth]);
