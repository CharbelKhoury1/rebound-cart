import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    // Webhook requests can trigger multiple times and after an app has already been uninstalled.
    // If this webhook already ran, the session may have been deleted previously.
    if (session) {
      await db.session.deleteMany({ where: { shop } });
      
      // Clean up shop-specific data when app is uninstalled
      await db.shopSettings.deleteMany({ where: { shop } });
      await db.abandonedCheckout.deleteMany({ where: { shop } });
      // Note: We keep sales reps and commissions as they might be needed for historical data
    }
  } catch (error) {
    console.error(`Error processing ${topic} webhook:`, error);
    return new Response("Webhook processing failed", { status: 500 });
  }

  return new Response("App uninstalled successfully", { status: 200 });
};
