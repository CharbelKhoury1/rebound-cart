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
  DataTable,
  Badge,
  Banner,
  Modal,
  Box,
  ProgressBar,
  Select,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { requirePlatformAdmin } from "../services/roles.server";
import { syncShopData } from "../utils/manual-sync.server";
import db from "../db.server";
import { useState, useEffect } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  requirePlatformAdmin(session as any);

  // Get all shops for the dropdown
  const shops = await db.session.findMany({
    where: {
      accessToken: { not: undefined },
      shop: { not: undefined }
    },
    select: { shop: true },
    distinct: ['shop'],
    orderBy: { shop: 'asc' }
  });

  return json({ 
    shops: shops.map(s => ({ label: s.shop, value: s.shop }))
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  requirePlatformAdmin(session as any);

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const selectedShop = formData.get("shop") as string;
  const syncAll = formData.get("syncAll") === "true";

  if (intent === "sync") {
    try {
      let results;

      if (syncAll) {
        // Get all shops
        const shops = await db.session.findMany({
          where: {
            accessToken: { not: undefined },
            shop: { not: undefined }
          },
          select: { shop: true },
          distinct: ['shop']
        });

        results = [];
        
        for (const shopRecord of shops) {
          try {
            const result = await syncShopData(admin, shopRecord.shop);
            results.push({
              shop: shopRecord.shop,
              ...result
            });
          } catch (error) {
            results.push({
              shop: shopRecord.shop,
              success: false,
              message: error instanceof Error ? error.message : "Unknown error",
              syncedCount: 0,
              errors: [error instanceof Error ? error.message : "Unknown error"]
            });
          }
        }
      } else if (selectedShop) {
        // Sync specific shop
        const result = await syncShopData(admin, selectedShop);
        results = [{
          shop: selectedShop,
          ...result
        }];
      } else {
        // Sync current shop
        const result = await syncShopData(admin, session.shop);
        results = [{
          shop: session.shop,
          ...result
        }];
      }

      return json({
        success: true,
        message: "Manual sync completed",
        results
      });

    } catch (error) {
      console.error("Manual sync error:", error);
      return json({
        success: false,
        message: error instanceof Error ? error.message : "Unknown error during sync",
        results: []
      }, { status: 500 });
    }
  }

  return json({ error: "Invalid intent" }, { status: 400 });
};

export default function ManualSyncPage() {
  const { shops } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [selectedShop, setSelectedShop] = useState("");
  const [syncAll, setSyncAll] = useState(false);

  useEffect(() => {
    if (fetcher.data && fetcher.state === "idle") {
      setSyncModalOpen(true);
    }
  }, [fetcher.data, fetcher.state]);

  const handleSync = () => {
    fetcher.submit(
      { 
        intent: "sync",
        shop: selectedShop,
        syncAll: syncAll.toString()
      },
      { method: "POST" }
    );
  };

  const shopOptions = [
    { label: "Current Shop", value: "" },
    { label: "All Shops", value: "all" },
    ...shops
  ];

  return (
    <Page>
      <TitleBar title="Manual Data Sync" />
      
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Manual Shopify to Supabase Sync</Text>
                
                <Banner tone="info" title="About Manual Sync">
                  <BlockStack gap="200">
                    <Text as="p">
                      This tool manually synchronizes abandoned checkout data from Shopify to your Supabase database.
                    </Text>
                    <Text as="p">
                      Use this when you need to ensure all records are up-to-date or if automatic sync has missed some data.
                    </Text>
                  </BlockStack>
                </Banner>

                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">Sync Configuration</Text>
                  
                  <Select
                    label="Select Shop(s) to Sync"
                    options={shopOptions}
                    value={syncAll ? "all" : selectedShop}
                    onChange={(value) => {
                      if (value === "all") {
                        setSyncAll(true);
                        setSelectedShop("");
                      } else {
                        setSyncAll(false);
                        setSelectedShop(value);
                      }
                    }}
                  />

                  {syncAll && (
                    <Banner tone="warning">
                      <Text as="p">
                        You have selected to sync all shops. This may take several minutes depending on the number of stores and checkouts.
                      </Text>
                    </Banner>
                  )}

                  <InlineStack gap="200">
                    <Button 
                      variant="primary" 
                      onClick={handleSync}
                      loading={fetcher.state === "loading"}
                      disabled={fetcher.state === "loading"}
                    >
                      {fetcher.state === "loading" ? "Syncing..." : "Start Sync"}
                    </Button>
                    <Button 
                      variant="plain"
                      onClick={() => {
                        setSelectedShop("");
                        setSyncAll(false);
                      }}
                    >
                      Reset
                    </Button>
                  </InlineStack>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>

      {/* Sync Results Modal */}
      <Modal
        open={syncModalOpen}
        onClose={() => {
          setSyncModalOpen(false);
        }}
        title="Sync Results"
      >
        <Modal.Section>
          <BlockStack gap="400">
            {fetcher.state === "loading" ? (
              <BlockStack gap="300">
                <Text as="p">Syncing checkouts from Shopify to Supabase...</Text>
                <ProgressBar size="small" />
                <Text as="p" tone="subdued">This may take a few minutes depending on the amount of data.</Text>
              </BlockStack>
            ) : fetcher.data && typeof fetcher.data === 'object' ? (
              <BlockStack gap="300">
                <Banner
                  tone={(fetcher.data as any).success ? "success" : "critical"}
                  title={(fetcher.data as any).success ? "Sync Completed" : "Sync Failed"}
                >
                  <Text as="p">{(fetcher.data as any).message}</Text>
                </Banner>
                
                {(fetcher.data as any).results && (fetcher.data as any).results.length > 0 && (
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingMd">Shop-by-Shop Results</Text>
                    {(fetcher.data as any).results.map((result: any, index: number) => (
                      <Card key={index}>
                        <BlockStack gap="200">
                          <InlineStack align="space-between">
                            <Text as="h4" variant="headingSm">{result.shop}</Text>
                            <Badge tone={result.success ? "success" : "critical"}>
                              {result.success ? "Success" : "Failed"}
                            </Badge>
                          </InlineStack>
                          <Text as="p" variant="bodySm">
                            {result.message}
                          </Text>
                          {result.syncedCount !== undefined && (
                            <Text as="p" variant="bodySm" tone="subdued">
                              Records synced: {result.syncedCount}
                            </Text>
                          )}
                          {result.errors && result.errors.length > 0 && (
                            <Box padding="200" background="bg-surface-secondary" borderRadius="200">
                              <BlockStack gap="100">
                                <Text as="p" variant="bodySm" tone="critical">
                                  <strong>Errors:</strong>
                                </Text>
                                {result.errors.map((error: string, errorIndex: number) => (
                                  <Text as="p" variant="bodySm" key={errorIndex}>
                                    • {error}
                                  </Text>
                                ))}
                              </BlockStack>
                            </Box>
                          )}
                        </BlockStack>
                      </Card>
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            ) : null}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
