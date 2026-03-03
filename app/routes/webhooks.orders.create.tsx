import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/* ============================================================
   TIER COMMISSION RATES — matches PlatformUser tier system
   ============================================================ */
const TIER_RATES: Record<string, number> = {
    PLATINUM: 25,
    GOLD: 20,
    SILVER: 18,
    BRONZE: 15,
};

const PLATFORM_FEE_RATE = 5; // 5% platform fee on top

export const action = async ({ request }: ActionFunctionArgs) => {
    const { shop, payload, topic } = await authenticate.webhook(request);

    console.log(`Received ${topic} webhook for ${shop}`);

    const { checkout_id, id, order_number, total_price } = payload;

    if (!checkout_id) {
        return new Response(); // Not from a tracked checkout
    }

    try {
        await db.$transaction(async (tx) => {
            // 1. Find the abandoned checkout and shop settings
            const abandonedCheckout = await tx.abandonedCheckout.findUnique({
                where: { checkoutId: String(checkout_id) },
                include: {
                    claimedBy: {
                        select: { id: true, tier: true, commissionRate: true, firstName: true, lastName: true, email: true },
                    },
                },
            });

            if (!abandonedCheckout || abandonedCheckout.status === "RECOVERED") {
                return; // Already processed or not found
            }

            const shopSettings = await tx.shopSettings.findUnique({
                where: { shop },
            });

            // 2. Mark checkout as recovered
            await tx.abandonedCheckout.update({
                where: { id: abandonedCheckout.id },
                data: {
                    status: "RECOVERED",
                    orderId: String(id),
                },
            });

            // 3. If claimed by a rep, calculate commission
            if (abandonedCheckout.claimedById && abandonedCheckout.claimedBy) {
                const rep = abandonedCheckout.claimedBy;
                const orderTotal = Number(total_price);

                // PRIORITY:
                // 1. Use ShopSettings commissionRate (The Merchant's offer)
                // 2. Fallback to 10% if not set
                const baseRate = shopSettings?.commissionRate ? Number(shopSettings.commissionRate) : 10;

                const totalCommissionPaidByMerchant = (orderTotal * baseRate) / 100;

                // Platform fee is calculated on the commission amount (e.g. 5% of the 10%)
                const platformFeeAmount = (totalCommissionPaidByMerchant * PLATFORM_FEE_RATE) / 100;
                const netCommissionForRep = totalCommissionPaidByMerchant - platformFeeAmount;

                await tx.commission.upsert({
                    where: { orderId: String(id) },
                    update: {
                        commissionAmount: netCommissionForRep,
                        totalAmount: orderTotal,
                        platformFee: platformFeeAmount,
                    },
                    create: {
                        orderId: String(id),
                        orderNumber: String(order_number),
                        totalAmount: orderTotal,
                        commissionAmount: netCommissionForRep,
                        platformFee: platformFeeAmount,
                        checkoutId: abandonedCheckout.id,
                        repId: abandonedCheckout.claimedById,
                        status: "PENDING",
                    },
                });

                // Update checkout with platform fee tracking
                await tx.abandonedCheckout.update({
                    where: { id: abandonedCheckout.id },
                    data: { platformFee: platformFeeAmount },
                });

                // 4. ADD TAGS TO SHOPIFY ORDER
                try {
                    const { admin } = await authenticate.webhook(request);
                    if (admin) {
                        const repName = `${rep.firstName || ""} ${rep.lastName || ""}`.trim() || rep.email;
                        await admin.graphql(
                            `#graphql
                            mutation addTags($id: ID!, $tags: [String!]!) {
                              tagsAdd(id: $id, tags: $tags) {
                                userErrors { field message }
                              }
                            }`,
                            {
                                variables: {
                                    id: `gid://shopify/Order/${id}`,
                                    tags: ["ReboundCart", "Rebound-Recovered", `Rep: ${repName}`],
                                },
                            }
                        );
                        console.log(`Tags added to order ${id}`);
                    }
                } catch (tagError) {
                    console.error("Failed to add tags to order:", tagError);
                    // Don't fail the whole transaction for tags
                }

                console.log(
                    `Commission created for order ${order_number}: ` +
                    `$${netCommissionForRep.toFixed(2)} (Rate: ${baseRate}%, Fee: $${platformFeeAmount.toFixed(2)})`
                );
            }
        });
    } catch (error) {
        console.error(`Error processing ${topic} webhook:`, error);
        return new Response("Webhook processing failed", { status: 500 });
    }

    return new Response("Webhook processed successfully", { status: 200 });
};
