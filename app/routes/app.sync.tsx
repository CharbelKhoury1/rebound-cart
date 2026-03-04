import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  InlineStack,
  Banner,
  ProgressBar,
  Badge,
  Box,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { syncShopData } from "../utils/manual-sync.server";
import db from "../db.server";
import { useState, useEffect } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Get current sync status
  const totalCheckouts = await db.abandonedCheckout.count({ where: { shop } });
  const abandonedCount = await db.abandonedCheckout.count({ 
    where: { shop, status: "ABANDONED" } 
  });
  const recoveredCount = await db.abandonedCheckout.count({ 
    where: { shop, status: "RECOVERED" } 
  });

  return json({
    totalCheckouts,
    abandonedCount,
    recoveredCount,
    shop
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const result = await syncShopData(admin, shop);
    
    // Get updated counts after sync
    const totalCheckouts = await db.abandonedCheckout.count({ where: { shop } });
    const abandonedCount = await db.abandonedCheckout.count({ 
      where: { shop, status: "ABANDONED" } 
    });
    const recoveredCount = await db.abandonedCheckout.count({ 
      where: { shop, status: "RECOVERED" } 
    });

    return json({
      success: true,
      message: result.message,
      syncedCount: result.syncedCount,
      errors: result.errors,
      updatedStats: {
        totalCheckouts,
        abandonedCount,
        recoveredCount
      }
    });

  } catch (error) {
    console.error("Merchant sync error:", error);
    return json({
      success: false,
      message: error instanceof Error ? error.message : "Unknown error during sync",
      errors: [error instanceof Error ? error.message : "Unknown error"]
    }, { status: 500 });
  }
};

export default function MerchantSyncPage() {
  const { totalCheckouts, abandonedCount, recoveredCount, shop } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [syncResults, setSyncResults] = useState<any>(null);

  const isSyncing = fetcher.state === "submitting";

  useEffect(() => {
    if (fetcher.data && fetcher.state === "idle") {
      setSyncResults(fetcher.data);
    }
  }, [fetcher.data, fetcher.state]);

  const currentStats = syncResults?.updatedStats || {
    totalCheckouts,
    abandonedCount,
    recoveredCount
  };

  return (
    <Page
      title="Data Synchronization"
    >
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Sync Your Store Data</Text>
                
                <Banner tone="info" title="About Manual Sync">
                  <BlockStack gap="200">
                    <Text as="p">
                      This tool synchronizes all abandoned checkout data from Shopify to your Supabase database.
                    </Text>
                    <Text as="p">
                      Records that already exist will be updated with the latest information, and new records will be added.
                    </Text>
                  </BlockStack>
                </Banner>

                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">Current Store: {shop}</Text>
                  
                  <InlineStack gap="400">
                    <Box minWidth="120px">
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">Total Checkouts</Text>
                        <Text as="p" variant="headingLg" fontWeight="bold">{currentStats.totalCheckouts}</Text>
                      </BlockStack>
                    </Box>
                    <Box minWidth="120px">
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">Abandoned</Text>
                        <Text as="p" variant="headingLg" fontWeight="bold">{currentStats.abandonedCount}</Text>
                      </BlockStack>
                    </Box>
                    <Box minWidth="120px">
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">Recovered</Text>
                        <Text as="p" variant="headingLg" fontWeight="bold" tone="success">{currentStats.recoveredCount}</Text>
                      </BlockStack>
                    </Box>
                  </InlineStack>

                  <Button 
                    variant="primary" 
                    size="large"
                    onClick={() => fetcher.submit({}, { method: "POST" })}
                    loading={isSyncing}
                    disabled={isSyncing}
                  >
                    {isSyncing ? "Syncing..." : "Sync All Checkouts"}
                  </Button>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          {isSyncing && (
            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">Sync in Progress</Text>
                  <ProgressBar size="small" />
                  <Text as="p" tone="subdued">
                    Please wait while we sync your abandoned checkout data from Shopify to Supabase...
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    This may take a few minutes depending on the amount of data to process.
                  </Text>
                </BlockStack>
              </Card>
            </Layout.Section>
          )}

          {syncResults && !isSyncing && (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Banner
                    tone={syncResults.success ? "success" : "critical"}
                    title={syncResults.success ? "Sync Completed" : "Sync Failed"}
                  >
                    <Text as="p">{syncResults.message}</Text>
                  </Banner>
                  
                  {syncResults.syncedCount !== undefined && (
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingMd">Sync Results</Text>
                      <InlineStack gap="400">
                        <Box minWidth="120px">
                          <BlockStack gap="100">
                            <Text as="p" variant="bodySm" tone="subdued">Records Synced</Text>
                            <Text as="p" variant="headingLg" fontWeight="bold">{syncResults.syncedCount}</Text>
                          </BlockStack>
                        </Box>
                        <Box minWidth="120px">
                          <BlockStack gap="100">
                            <Text as="p" variant="bodySm" tone="subdued">Total Checkouts</Text>
                            <Text as="p" variant="headingLg" fontWeight="bold">{syncResults.updatedStats?.totalCheckouts || 0}</Text>
                          </BlockStack>
                        </Box>
                      </InlineStack>
                    </BlockStack>
                  )}

                  {syncResults.errors && syncResults.errors.length > 0 && (
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm" tone="critical">Errors Encountered</Text>
                      <Box padding="200" background="bg-surface-secondary" borderRadius="200">
                        <BlockStack gap="100">
                          {syncResults.errors.map((error: string, index: number) => (
                            <Text as="p" variant="bodySm" key={index}>
                              • {error}
                            </Text>
                          ))}
                        </BlockStack>
                      </Box>
                    </BlockStack>
                  )}

                  <InlineStack gap="200">
                    <Button variant="primary" url="/app/checkouts">
                      View All Checkouts
                    </Button>
                    <Button variant="plain" url="/app">
                      Back to Dashboard
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            </Layout.Section>
          )}
        </Layout>
      </BlockStack>
    </Page>
  );
}
