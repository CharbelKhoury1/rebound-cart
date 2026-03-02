import db from "./app/db.server";
import { unauthenticated } from "./app/shopify.server";

async function testFetch() {
    const shop = "abandoned-checkout-sales-commission-app.myshopify.com";
    try {
        const { admin } = await unauthenticated.admin(shop);
        console.log("Testing GraphQL (basic fields)...");
        const gqlResponse = await admin.graphql(
            `#graphql
      query {
        abandonedCheckouts(first: 5) {
          edges {
            node {
              id
            }
          }
        }
      }`
        );
        const gqlJson = await gqlResponse.json();
        console.log("GraphQL Result:", JSON.stringify(gqlJson, null, 2));
    } catch (e) {
        console.error("GraphQL failed:", e.message);
    }

    try {
        const { admin } = await unauthenticated.admin(shop);
        console.log("\nTesting REST API...");
        // Abandoned checkouts REST endpoint
        const restResponse = await admin.rest.get({
            path: "abandoned_checkouts"
        });
        const restJson = await restResponse.json();
        console.log("REST Result (count):", restJson.abandoned_checkouts?.length);
    } catch (e) {
        console.error("REST failed:", e.message);
    }
}

testFetch();
