import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { shop, payload, topic } = await authenticate.webhook(request);

    console.log(`Received ${topic} webhook for ${shop}`);

    const { id, email, total_price, currency } = payload;

    try {
        await db.abandonedCheckout.upsert({
            where: { checkoutId: String(id) },
            update: {
                totalPrice: total_price,
                currency,
                email: email || null,
            },
            create: {
                shop,
                checkoutId: String(id),
                email: email || null,
                totalPrice: total_price,
                currency,
                status: "ABANDONED",
            },
        });
    } catch (error) {
        console.error(`Error processing ${topic} webhook:`, error);
    }

    return new Response();
};
