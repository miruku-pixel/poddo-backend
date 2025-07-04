// pages/api/reports/unlock-cash-reconciliation.ts

import { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../../lib/prisma";
import { withAuth } from "../../../middleware/authMiddleware"; // Your provided withAuth
import { corsMiddleware } from "../../../middleware/cors";

// Define the AuthenticatedRequest interface to extend NextApiRequest
// This is crucial for TypeScript to understand that `req.user` exists
interface AuthenticatedRequest extends NextApiRequest {
  user?: {
    id: string;
    role: string; // Ensure this matches the `user.role` from your JWT payload / Prisma user model
  };
}

async function handler(req: AuthenticatedRequest, res: NextApiResponse) {
  // Ensure only POST requests
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ error: "Method not allowed, please use POST" });
  }

  // --- Crucial Role Check ---
  // Ensure user is authenticated and has ADMIN role
  // 'req.user' is populated by your 'withAuth' middleware
  // 'req.user.role' contains the role string
  if (!req.user || req.user.role !== "ADMIN") {
    // <--- THIS IS THE IMPORTANT LINE
    return res
      .status(403)
      .json({ error: "Forbidden: Only Admin can unlock this report." });
  }

  try {
    const { outletId, date } = req.body;

    // Input Validation
    if (!outletId) {
      return res.status(400).json({ error: "Outlet ID is required." });
    }
    if (!date) {
      return res
        .status(400)
        .json({ error: "Date parameter is required (YYYY-MM-DD)." });
    }

    // --- FIX: Robust Date Handling to ensure UTC consistency ---
    const dateString = date as string;
    const parts = dateString.split("-").map(Number);
    // Create Date object in UTC to avoid local timezone interpretation issues
    // Month is 0-indexed in JavaScript Date constructor, so subtract 1 from month part
    const targetDateUTC = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));

    // startOfDayUTC is now guaranteed to be YYYY-MM-DD 00:00:00 UTC
    const startOfDayUTC = targetDateUTC;

    // Find and update the reconciliation record
    const updatedRecord = await prisma.dailyCashReconciliation.update({
      where: {
        outletId_date: {
          outletId: outletId as string,
          date: startOfDayUTC,
        },
      },
      data: {
        isLocked: false, // Set to unlocked
      },
    });

    if (!updatedRecord) {
      return res.status(404).json({
        error:
          "Reconciliation record not found for the specified date and outlet.",
      });
    }

    res.status(200).json({
      message: "Daily cash reconciliation unlocked successfully.",
      data: updatedRecord,
    });
  } catch (error) {
    console.error("Error unlocking daily cash reconciliation:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

function applyMiddleware(handler: any, middlewares: any[]) {
  return middlewares.reduceRight((next, mw) => mw(next), handler);
}

export default applyMiddleware(handler, [corsMiddleware, withAuth]);
