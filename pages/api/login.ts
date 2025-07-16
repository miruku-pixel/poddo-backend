import { NextApiRequest, NextApiResponse } from "next";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { corsMiddleware, applyMiddleware } from "../../middleware/cors";

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { username, password, outletId } = req.body;

  if (!username || !password || !outletId) {
    return res
      .status(400)
      .json({ error: "Username, password, and outlet are required" });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { username },
      include: {
        outlet: true,
        OutletAccess: {
          include: {
            outlet: true, // or select: { id: true, name: true }
          },
        },
      },
    });

    if (!user) {
      return res
        .status(401)
        .json({ error: "Invalid username, password, or outlet" });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    // 🔐 Outlet access logic
    const outletAccessList = user.OutletAccess.map((access) => access.outletId);
    const hasAccess =
      outletAccessList.length > 0
        ? outletAccessList.includes(outletId)
        : user.outletId === outletId;

    if (!hasAccess) {
      return res
        .status(403)
        .json({ error: "You do not have access to this outlet" });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role, outletId }, // include selected outletId
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    console.log("User login outlet resolution:", {
      selectedOutlet:
        user.OutletAccess.find((oa) => oa.outletId === outletId)?.outlet.name ||
        user.outlet?.name ||
        null,
    });

    return res.status(200).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        outletId,
        outlet:
          user.OutletAccess.find((oa) => oa.outletId === outletId)?.outlet
            .name ||
          user.outlet?.name ||
          null,
        OutletAccess: user.OutletAccess, // <-- return the data, not include/select
      },
    });
  } catch (err) {
    console.error("[Login Error]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

export default applyMiddleware(handler, [corsMiddleware]);
