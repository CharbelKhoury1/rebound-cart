import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  InlineStack,
  DataTable,
  Badge,
  Select,
  Banner,
  EmptyState,
  Filters,
  Grid,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { useState } from "react";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "sync") {
    try {
      // Re-authenticate to ensure session is fresh and get accessToken
      const { session } = await authenticate.admin(request);
      const shop = session.shop;
      const accessToken = session.accessToken;

      // Direct fetch to REST API (often more permissive for unprotected data in dev)
      const response = await fetch(
        `https://${shop}/admin/api/2025-01/abandoned_checkouts.json`,
        {
          headers: {
            "X-Shopify-Access-Token": accessToken!,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.errors || `Shopify API returned ${response.status}`);
      }

      const responseJson: any = await response.json();
      const abandonedCheckouts = responseJson.abandoned_checkouts || [];

      console.log(`REST Sync: Found ${abandonedCheckouts.length} checkouts`);

      for (const checkout of abandonedCheckouts) {
        await db.abandonedCheckout.upsert({
          where: { checkoutId: String(checkout.id) },
          update: {
            totalPrice: checkout.total_price,
            currency: checkout.currency,
            email: checkout.email || null,
          },
          create: {
            shop,
            checkoutId: String(checkout.id),
            email: checkout.email || null,
            totalPrice: checkout.total_price,
            currency: checkout.currency,
            checkoutUrl: checkout.abandoned_checkout_url,
            status: "ABANDONED",
            createdAt: new Date(checkout.created_at),
          },
        });
      }

      return json({ success: true, count: abandonedCheckouts.length });
    } catch (error: any) {
      console.error("Sync Error:", error);
      return json({
        success: false,
        error: error.message || "Failed to fetch. Please check 'Protected Customer Data' in Partner Dashboard."
      }, { status: 500 });
    }
  }

  return json({ success: false });
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || undefined;
  const claimed = url.searchParams.get("claimed") || undefined;

  let whereClause: any = { shop };

  if (status) {
    whereClause.status = status;
  }

  if (claimed === "true") {
    whereClause.claimedById = { not: null };
  } else if (claimed === "false") {
    whereClause.claimedById = null;
  }

  const checkouts = await db.abandonedCheckout.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" },
    include: { claimedBy: true },
    take: 100,
  });

  const stats = {
    total: await db.abandonedCheckout.count({ where: { shop } }),
    abandoned: await db.abandonedCheckout.count({ where: { shop, status: "ABANDONED" } }),
    recovered: await db.abandonedCheckout.count({ where: { shop, status: "RECOVERED" } }),
    unclaimed: await db.abandonedCheckout.count({ where: { shop, claimedById: null } }),
  };

  return json({ checkouts, stats });
};

export default function CheckoutsPage() {
  const { checkouts, stats } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const checkoutRows = checkouts.map((checkout) => [
    checkout.checkoutId.slice(-8) + "…",
    checkout.email || "N/A",
    `${Number(checkout.totalPrice).toFixed(2)} ${checkout.currency}`,
    <Badge tone={checkout.status === "RECOVERED" ? "success" : "attention"}>
      {checkout.status}
    </Badge>,
    checkout.claimedBy
      ? `${checkout.claimedBy.firstName || ""} ${checkout.claimedBy.lastName || ""}`.trim()
      : <Badge tone="new">Waiting</Badge>,
    new Date(checkout.createdAt).toLocaleDateString(),
  ]);

  const handleSync = () => {
    fetcher.submit({ intent: "sync" }, { method: "post" });
  };

  const isSyncing = fetcher.state === "submitting" && fetcher.formData?.get("intent") === "sync";

  return (
    <Page>
      <TitleBar title="Abandoned Checkouts">
        <button variant="primary" onClick={handleSync}>
          Sync from Shopify
        </button>
      </TitleBar>

      <BlockStack gap="500">
        {/* Stats */}
        <Layout>
          <Layout.Section>
            <Grid>
              {[
                { label: "Total Checkouts", value: stats.total, tone: "base" },
                { label: "Abandoned", value: stats.abandoned, tone: "attention" },
                { label: "Recovered", value: stats.recovered, tone: "success" },
                { label: "Pending Claim", value: stats.unclaimed, tone: "new" },
              ].map(({ label, value, tone }) => (
                <Grid.Cell key={label} columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                  <Card>
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
                      <Text as="p" variant="headingLg" tone={tone as any} fontWeight="bold">{value}</Text>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
              ))}
            </Grid>
          </Layout.Section>
        </Layout>

        {/* Table */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">My Store's Abandoned Checkouts</Text>

                {checkouts.length === 0 ? (
                  <EmptyState
                    heading="No checkouts yet"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>Abandoned checkouts from your Shopify store will appear here as they are detected.</p>
                  </EmptyState>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text", "text", "text"]}
                    headings={["Checkout ID", "Customer", "Amount", "Status", "Assigned Rep", "Detected On"]}
                    rows={checkoutRows}
                    hoverable
                  />
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
