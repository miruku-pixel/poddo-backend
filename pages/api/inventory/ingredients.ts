import { NextApiRequest, NextApiResponse } from "next";
import { PrismaClient } from "@prisma/client";
import { withAuth } from "../../../middleware/authMiddleware"; // Adjust path as needed
import { corsMiddleware } from "../../../middleware/cors"; // Adjust path as needed

const prisma = new PrismaClient();

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Handle OPTIONS method for CORS preflight requests
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Only allow GET requests for this endpoint
  if (req.method !== "GET") {
    return res
      .status(405)
      .json({ error: "Method not allowed, please use GET" });
  }

  // Extract outletId from the query parameters
  const { outletId } = req.query;

  // Validate that outletId is provided and is a string
  if (!outletId || typeof outletId !== "string") {
    return res.status(400).json({
      error: "Missing or invalid query parameter: outletId (UUID is required).",
    });
  }

  try {
    // 1. Find all unique ingredient IDs that are linked to Food items
    //    which belong to the specified outletId.
    const foodIngredientsInOutletFoods = await prisma.foodIngredient.findMany({
      where: {
        food: {
          outletId: outletId, // Filter by the outlet ID associated with the food
        },
      },
      select: {
        ingredientId: true, // Select only the ingredient ID
      },
      distinct: ["ingredientId"], // Get only unique ingredient IDs to avoid duplicates
    });

    // Extract the array of unique ingredient IDs
    const ingredientIds = foodIngredientsInOutletFoods.map(
      (fi) => fi.ingredientId
    );

    // If no ingredients are found for foods in this outlet, return an empty array
    if (ingredientIds.length === 0) {
      return res.status(200).json([]);
    }

    // 2. Fetch the full details (id, name, unit) for these unique ingredients
    const ingredients = await prisma.ingredient.findMany({
      where: {
        id: {
          in: ingredientIds, // Filter ingredients by the IDs found above
        },
      },
      select: {
        id: true,
        name: true,
        unit: true,
      },
      orderBy: {
        name: "asc", // Order ingredients alphabetically by name for better display in the UI
      },
    });

    // Return the list of ingredients
    return res.status(200).json(ingredients);
  } catch (error: any) {
    // Log the error for debugging purposes
    console.error("[GET /api/ingredients API Error]", error);
    // Return a 500 Internal Server Error with a more helpful message if available
    return res
      .status(500)
      .json({ error: error.message || "Internal server error" });
  }
}

export default applyMiddleware(handler, [corsMiddleware, withAuth]);

// Helper function to apply middleware (copy from your project if different)
function applyMiddleware(handler: any, middlewares: any[]) {
  return middlewares.reduceRight((next, mw) => mw(next), handler);
}
