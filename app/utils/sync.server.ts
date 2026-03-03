import { AdminApiContext } from "@shopify/shopify-app-remix/server";
import db from "../db.server";

export async function syncCheckouts(admin: AdminApiContext, shop: string) {
    try {
        console.log(`Starting automated sync for: ${shop}`);

        const response = await admin.graphql(
            `#graphql
      query {
        abandonedCheckouts(first: 50) {
          edges {
            node {
              id
              email
              totalPriceSet {
                presentmentMoney {
                  amount
                  currencyCode
                }
              }
              abandonedCheckoutUrl
              createdAt
            }
          }
        }
      }`
        );

        const responseJson: any = await response.json();
        const edges = responseJson.data?.abandonedCheckouts?.edges || [];

        console.log(`Sync found ${edges.length} checkouts`);

        for (const edge of edges) {
            const node = edge.node;
            const checkoutId = node.id.split("/").pop();

            await db.abandonedCheckout.upsert({
                where: { checkoutId: String(checkoutId) },
                update: {
                    totalPrice: node.totalPriceSet?.presentmentMoney?.amount || 0,
                    currency: node.totalPriceSet?.presentmentMoney?.currencyCode || "USD",
                    email: node.email || null,
                },
                create: {
                    shop,
                    checkoutId: String(checkoutId),
                    email: node.email || null,
                    totalPrice: node.totalPriceSet?.presentmentMoney?.amount || 0,
                    currency: node.totalPriceSet?.presentmentMoney?.currencyCode || "USD",
                    checkoutUrl: node.abandonedCheckoutUrl,
                    status: "ABANDONED",
                    createdAt: new Date(node.createdAt),
                },
            });
        }

        return { success: true, count: edges.length };
    } catch (error) {
        console.error("Sync Error in utility:", error);
        return { success: false, error };
    }
}
