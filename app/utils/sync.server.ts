import { AdminApiContext } from "@shopify/shopify-app-remix/server";
import db from "../db.server";

export async function syncCheckouts(admin: AdminApiContext, shop: string) {
    try {
        console.log(`Starting automated sync for: ${shop}`);

        // Attempt 1: Full sync with customer data
        let response = await admin.graphql(
            `#graphql
      query {
        abandonedCheckouts(first: 50) {
          edges {
            node {
              id
              customer {
                email
                firstName
                lastName
              }
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

        let responseJson: any = await response.json();

        // Fallback: If access denied for customer, try basic sync
        if (responseJson.errors && responseJson.errors.some((e: any) => e.message.includes("Access denied"))) {
            console.warn("Access denied for customer field, falling back to basic sync...");
            response = await admin.graphql(
                `#graphql
        query {
          abandonedCheckouts(first: 50) {
            edges {
              node {
                id
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
            responseJson = await response.json();
        }

        if (responseJson.errors) {
            console.error("Shopify GraphQL errors:", JSON.stringify(responseJson.errors, null, 2));
            return { success: false, error: responseJson.errors[0].message };
        }

        const edges = responseJson.data?.abandonedCheckouts?.edges || [];
        console.log(`Sync found ${edges.length} checkouts`);

        let syncCount = 0;
        for (const edge of edges) {
            try {
                const node = edge.node;
                const checkoutId = node.id.split("/").pop();

                // Handle potential missing customer object in fallback or guest checkouts
                const email = node.customer?.email || null;
                const firstName = node.customer?.firstName || "";
                const lastName = node.customer?.lastName || "";
                const name = `${firstName} ${lastName}`.trim() || null;

                await db.abandonedCheckout.upsert({
                    where: { checkoutId: String(checkoutId) },
                    update: {
                        totalPrice: node.totalPriceSet?.presentmentMoney?.amount || 0,
                        currency: node.totalPriceSet?.presentmentMoney?.currencyCode || "USD",
                        email: email,
                        name: name,
                    },
                    create: {
                        shop,
                        checkoutId: String(checkoutId),
                        email: email,
                        name: name,
                        totalPrice: node.totalPriceSet?.presentmentMoney?.amount || 0,
                        currency: node.totalPriceSet?.presentmentMoney?.currencyCode || "USD",
                        checkoutUrl: node.abandonedCheckoutUrl,
                        status: "ABANDONED",
                        createdAt: new Date(node.createdAt),
                    },
                });
                syncCount++;
            } catch (loopError) {
                console.error(`Error processing checkout node:`, loopError);
            }
        }

        return { success: true, count: syncCount };
    } catch (error) {
        console.error("Sync Error in utility:", error);
        return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
}
