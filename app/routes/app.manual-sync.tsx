import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { requirePlatformAdmin } from "../services/roles.server";
import { syncShopData } from "../utils/manual-sync.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  requirePlatformAdmin(session as any);

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const formData = await request.formData();
    const shop = formData.get("shop") as string;
    const syncAll = formData.get("syncAll") === "true";

    let results;

    if (syncAll) {
      // Sync all shops
      const shops = await db.session.findMany({
        where: {
          accessToken: { not: undefined },
          shop: { not: undefined }
        },
        select: { shop: true, accessToken: true },
        distinct: ['shop']
      });

      results = [];
      
      for (const shopRecord of shops) {
        try {
          // Create admin context for each shop
          const shopAdmin = {
            graphql: admin.graphql,
          };

          const result = await syncShopData(shopAdmin, shopRecord.shop);
          results.push({
            shop: shopRecord.shop,
            ...result
          });
        } catch (error) {
          results.push({
            shop: shopRecord.shop,
            success: false,
            message: error instanceof Error ? error.message : "Unknown error",
            syncedCount: 0,
            errors: [error instanceof Error ? error.message : "Unknown error"]
          });
        }
      }
    } else if (shop) {
      // Sync specific shop
      const result = await syncShopData(admin, shop);
      results = [{
        shop,
        ...result
      }];
    } else {
      // Sync current shop
      const result = await syncShopData(admin, session.shop);
      results = [{
        shop: session.shop,
        ...result
      }];
    }

    return json({
      success: true,
      message: "Manual sync completed",
      results
    });

  } catch (error) {
    console.error("Manual sync error:", error);
    return json({
      success: false,
      message: error instanceof Error ? error.message : "Unknown error during sync"
    }, { status: 500 });
  }
};
