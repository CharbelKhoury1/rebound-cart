import { AdminApiContext } from "@shopify/shopify-app-remix/server";
import db from "../db.server";

interface SyncResult {
  success: boolean;
  message: string;
  syncedCount?: number;
  errors?: string[];
  totalCheckouts?: number;
}

export async function manualSyncAllCheckouts(admin: AdminApiContext, shop: string): Promise<SyncResult> {
  const errors: string[] = [];
  let totalSynced = 0;
  let cursor: string | null = null;
  let hasMore = true;
  const maxRetries = 3;

  console.log(`Starting manual full sync for shop: ${shop}`);

  while (hasMore) {
    let retryCount = 0;
    let success = false;

    while (retryCount < maxRetries && !success) {
      try {
        // Try full sync first - use a nullable cursor variable for pagination
        let response = await admin.graphql(
          `#graphql
          query getAbandonedCheckouts($cursor: String) {
            abandonedCheckouts(first: 50, after: $cursor) {
              edges {
                node {
                  id
                  customer {
                    email
                    firstName
                    lastName
                    phone
                  }
                  totalPriceSet {
                    presentmentMoney {
                      amount
                      currencyCode
                    }
                  }
                  abandonedCheckoutUrl
                  createdAt
                  updatedAt
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }`,
          {
            variables: {
              cursor,
            },
          }
        );

        let responseJson: any = await response.json();

        // Fallback: If access denied for customer data, try basic sync
        if (responseJson.errors && responseJson.errors.some((e: any) => e.message.includes("Access denied"))) {
          console.warn("Access denied for detailed fields, falling back to basic sync...");
          response = await admin.graphql(
            `#graphql
            query getAbandonedCheckoutsBasic($cursor: String) {
              abandonedCheckouts(first: 50, after: $cursor) {
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
                    updatedAt
                  }
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }`,
            {
              variables: {
                cursor,
              },
            }
          );
          responseJson = await response.json();
        }

        if (responseJson.errors) {
          console.error("Shopify GraphQL errors:", JSON.stringify(responseJson.errors, null, 2));
          throw new Error(responseJson.errors[0].message);
        }

        const edges = responseJson.data?.abandonedCheckouts?.edges || [];
        const pageInfo = responseJson.data?.abandonedCheckouts?.pageInfo;

        if (edges.length === 0 && !cursor) {
          return {
            success: true,
            message: "No abandoned checkouts found in Shopify",
            syncedCount: 0,
            totalCheckouts: 0
          };
        }

        console.log(`Found ${edges.length} checkouts in current batch`);

        // Process each checkout
        for (const edge of edges) {
          try {
            const node = edge.node;
            const checkoutId = node.id.split("/").pop();

            // Handle customer data (might be null in fallback mode)
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
                updatedAt: new Date(node.updatedAt),
                // Store additional data as JSON if needed
                // Note: You might want to add these fields to your schema
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
                updatedAt: new Date(node.updatedAt),
              },
            });

            totalSynced++;
          } catch (checkoutError) {
            const errorMsg = `Error processing checkout ${edge.node.id}: ${checkoutError instanceof Error ? checkoutError.message : 'Unknown error'}`;
            console.error(errorMsg);
            errors.push(errorMsg);
          }
        }

        // Update pagination info
        hasMore = pageInfo?.hasNextPage || false;
        cursor = pageInfo?.endCursor || null;
        success = true;

        console.log(`Batch completed. Total synced so far: ${totalSynced}`);

      } catch (error) {
        retryCount++;
        const errorMsg = `Attempt ${retryCount} failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(errorMsg);
        
        if (retryCount >= maxRetries) {
          errors.push(errorMsg);
          hasMore = false; // Stop pagination on final retry failure
        } else {
          // Wait before retrying (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
        }
      }
    }
  }

  console.log(`Manual sync completed for ${shop}. Total synced: ${totalSynced}, Errors: ${errors.length}`);

  return {
    success: errors.length === 0,
    message: errors.length === 0 
      ? `Successfully synced ${totalSynced} checkouts` 
      : `Synced ${totalSynced} checkouts with ${errors.length} errors`,
    syncedCount: totalSynced,
    errors: errors.length > 0 ? errors : undefined,
    totalCheckouts: totalSynced
  };
}

export async function syncShopData(admin: AdminApiContext, shop: string): Promise<SyncResult> {
  try {
    // First sync checkouts
    const checkoutResult = await manualSyncAllCheckouts(admin, shop);
    
    // You can extend this to sync other data types like orders, customers, etc.
    // const orderResult = await manualSyncAllOrders(admin, shop);
    // const customerResult = await manualSyncAllCustomers(admin, shop);

    return checkoutResult;
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown sync error",
      errors: [error instanceof Error ? error.message : "Unknown error"]
    };
  }
}

// Legacy function for backward compatibility
export async function syncCheckouts(admin: AdminApiContext, shop: string) {
  return manualSyncAllCheckouts(admin, shop);
}
