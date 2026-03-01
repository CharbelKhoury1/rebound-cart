import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { shop, payload, topic } = await authenticate.webhook(request);

    console.log(`Received ${topic} webhook for ${shop}`);

    const { checkout_id, id, order_number, total_price } = payload;

    if (!checkout_id) {
        return new Response(); // Not from a tracked checkout
    }

    try {
        const abandonedCheckout = await db.abandonedCheckout.findUnique({
            where: { checkoutId: String(checkout_id) },
        });

        if (abandonedCheckout && abandonedCheckout.status !== "RECOVERED") {
            // 1. Mark as Recovered
            await db.abandonedCheckout.update({
                where: { id: abandonedCheckout.id },
                data: {
                    status: "RECOVERED",
                    orderId: String(id),
                },
            });

            // 2. If it was claimed by a rep, calculate commission
            if (abandonedCheckout.claimedById) {
                const settings = await db.shopSettings.findUnique({
                    where: { shop },
                });

                const rate = settings?.commissionRate ? Number(settings.commissionRate) : 10;
                const commissionAmount = (Number(total_price) * rate) / 100;

                await db.commission.upsert({
                    where: { orderId: String(id) },
                    update: {
                        commissionAmount,
                        totalAmount: total_price,
                    },
                    create: {
                        orderId: String(id),
                        orderNumber: String(order_number),
                        totalAmount: total_price,
                        commissionAmount,
                        checkoutId: abandonedCheckout.id,
                        repId: abandonedCheckout.claimedById,
                    },
                });
            }
        }
    } catch (error) {
        console.error(`Error processing ${topic} webhook:`, error);
    }

    return new Response();
};
