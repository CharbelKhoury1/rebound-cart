import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Payload for checkouts/create usually includes id, email, token, total_price, etc.
  const { id, email, token, total_price, currency } = payload;

  try {
    await db.abandonedCheckout.upsert({
      where: { checkoutId: String(id) },
      update: {
        totalPrice: total_price,
        currency: currency,
        email: email || null,
      },
      create: {
        shop,
        checkoutId: String(id),
        cartToken: token,
        email: email || null,
        totalPrice: total_price,
        currency,
        status: "ABANDONED",
      },
    });
  } catch (error) {
    console.error(`Error processing ${topic} webhook:`, error);
    return new Response("Webhook processing failed", { status: 500 });
  }

  return new Response("Webhook processed successfully", { status: 200 });
};
