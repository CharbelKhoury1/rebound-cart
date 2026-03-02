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
            // 1. Find the abandoned checkout
            const abandonedCheckout = await tx.abandonedCheckout.findUnique({
                where: { checkoutId: String(checkout_id) },
                include: {
                    claimedBy: {
                        select: { id: true, tier: true, commissionRate: true },
                    },
                },
            });

            if (!abandonedCheckout || abandonedCheckout.status === "RECOVERED") {
                return; // Already processed or not found
            }

            // 2. Mark checkout as recovered
            await tx.abandonedCheckout.update({
                where: { id: abandonedCheckout.id },
                data: {
                    status: "RECOVERED",
                    orderId: String(id),
                },
            });

            // 3. If claimed by a rep, calculate commission using tier rate
            if (abandonedCheckout.claimedById && abandonedCheckout.claimedBy) {
                const rep = abandonedCheckout.claimedBy;
                const orderTotal = Number(total_price);

                // Use rep's custom commission rate if set, else use tier rate
                const commissionRate =
                    rep.commissionRate !== null && rep.commissionRate !== undefined
                        ? Number(rep.commissionRate)
                        : TIER_RATES[rep.tier ?? "BRONZE"] ?? 15;

                const commissionAmount = (orderTotal * commissionRate) / 100;

                // Platform fee is calculated on the commission amount
                const platformFeeAmount = (commissionAmount * PLATFORM_FEE_RATE) / 100;
                const netCommission = commissionAmount - platformFeeAmount;

                await tx.commission.upsert({
                    where: { orderId: String(id) },
                    update: {
                        commissionAmount: netCommission,
                        totalAmount: orderTotal,
                        platformFee: platformFeeAmount,
                    },
                    create: {
                        orderId: String(id),
                        orderNumber: String(order_number),
                        totalAmount: orderTotal,
                        commissionAmount: netCommission,
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

                console.log(
                    `Commission created for order ${order_number}: ` +
                    `$${netCommission.toFixed(2)} (${commissionRate}% rate, $${platformFeeAmount.toFixed(2)} platform fee)`
                );
            }
        });
    } catch (error) {
        console.error(`Error processing ${topic} webhook:`, error);
        return new Response("Webhook processing failed", { status: 500 });
    }

    return new Response("Webhook processed successfully", { status: 200 });
};
