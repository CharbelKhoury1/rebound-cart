import { unauthenticated } from "./app/shopify.server";
import db from "./app/db.server";

async function sync() {
    const shop = "abandoned-checkout-sales-commission-app.myshopify.com";
    try {
        const { admin } = await unauthenticated.admin(shop);
        console.log(`Syncing for ${shop}...`);

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

        const responseJson = await response.json();
        const abandonedCheckouts = responseJson.data.abandonedCheckouts.edges;
        console.log(`Found ${abandonedCheckouts.length} checkouts in Shopify.`);

        for (const edge of abandonedCheckouts) {
            const node = edge.node;
            const checkoutId = node.id.split("/").pop();

            await db.abandonedCheckout.upsert({
                where: { checkoutId: String(checkoutId) },
                update: {
                    totalPrice: node.totalPriceSet.presentmentMoney.amount,
                    currency: node.totalPriceSet.presentmentMoney.currencyCode,
                    email: node.email,
                },
                create: {
                    shop,
                    checkoutId: String(checkoutId),
                    email: node.email,
                    totalPrice: node.totalPriceSet.presentmentMoney.amount,
                    currency: node.totalPriceSet.presentmentMoney.currencyCode,
                    checkoutUrl: node.abandonedCheckoutUrl,
                    status: "ABANDONED",
                    createdAt: new Date(node.createdAt),
                },
            });
        }
        console.log("Sync complete.");
    } catch (e) {
        console.error("Sync failed:", e);
    }
}

sync();
