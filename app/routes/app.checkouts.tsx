import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useRouteError, isRouteErrorResponse } from "@remix-run/react";
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
  Modal,
  DescriptionList,
  Box,
  Divider,
  Link,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getStoreCheckoutsWithStats } from "../services/checkouts.server";
import { useState, useEffect } from "react";
import { syncCheckouts } from "../utils/sync.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "sync") {
    const result = await syncCheckouts(admin, shop);
    if (result.success) {
      return json({ success: true, count: result.count });
    } else {
      return json({ success: false, error: (result as any).error || "Failed to sync checkouts" }, { status: 500 });
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

  const { checkouts, stats } = await getStoreCheckoutsWithStats({
    shop,
    status,
    claimed,
  });

  return json({ checkouts, stats });
};

export default function CheckoutsPage() {
  const { checkouts, stats } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const [selectedCheckout, setSelectedCheckout] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const checkoutRows = checkouts.map((checkout) => [
    <Button variant="plain" onClick={() => { setSelectedCheckout(checkout); setIsModalOpen(true); }}>
      {checkout.checkoutId.slice(-8) + "…"}
    </Button>,
    checkout.email || "N/A",
    `${Number(checkout.totalPrice).toFixed(2)} ${checkout.currency}`,
    <Badge key="status" tone={checkout.status === "RECOVERED" ? "success" : "attention"}>
      {checkout.status}
    </Badge>,
    checkout.claimedBy ? (
      <InlineStack gap="100" blockAlign="center">
        <Badge tone="info">Claimed</Badge>
        <Text as="span" variant="bodySm">
          {`${checkout.claimedBy.firstName || ""} ${checkout.claimedBy.lastName || ""}`.trim() || checkout.claimedBy.email}
        </Text>
      </InlineStack>
    ) : (
      <Badge tone="new">Awaiting Assignment</Badge>
    ),
    new Date(checkout.createdAt).toLocaleDateString(),
  ]);

  const handleSync = () => {
    fetcher.submit({ intent: "sync" }, { method: "post" });
  };

  const isSyncing = fetcher.state === "submitting" && fetcher.formData?.get("intent") === "sync";
  const [syncResult, setSyncResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    const data = fetcher.data as any;
    if (data) {
      if (data.success) {
        setSyncResult({ success: true, message: `Successfully synced ${data.count} checkouts!` });
      } else if (data.error) {
        setSyncResult({ success: false, message: data.error });
      }
    }
  }, [fetcher.data]);

  return (
    <Page
      title="Abandoned Checkouts"
      primaryAction={{
        content: isSyncing ? "Syncing..." : "Sync from Shopify",
        onAction: handleSync,
        loading: isSyncing,
      }}
    >
      <TitleBar title="Abandoned Checkouts" />

      <BlockStack gap="500">
        {syncResult && (
          <Banner
            title={syncResult.success ? "Sync Complete" : "Sync Failed"}
            tone={syncResult.success ? "success" : "critical"}
            onDismiss={() => setSyncResult(null)}
          >
            <p>{syncResult.message}</p>
          </Banner>
        )}
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
                    headings={["ID", "Customer", "Amount", "Status", "Assignment", "Detected On"]}
                    rows={checkoutRows}
                    hoverable
                  />
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>

      {/* Checkout Details Modal */}
      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Checkout Details"
        primaryAction={{
          content: "Close",
          onAction: () => setIsModalOpen(false),
        }}
        secondaryActions={[
          {
            content: "View on Shopify",
            disabled: !selectedCheckout?.checkoutUrl,
            onAction: () => {
              if (selectedCheckout?.checkoutUrl) {
                window.open(selectedCheckout.checkoutUrl, "_blank");
              }
            },
          },
        ]}
      >
        <Modal.Section>
          {selectedCheckout && (
            <BlockStack gap="400">
              <DescriptionList
                items={[
                  {
                    term: "Checkout ID",
                    description: selectedCheckout.checkoutId,
                  },
                  {
                    term: "Creation Date",
                    description: new Date(selectedCheckout.createdAt).toLocaleString(),
                  },
                  {
                    term: "Customer Email",
                    description: selectedCheckout.email || "No email provided",
                  },
                  {
                    term: "Total Value",
                    description: `${Number(selectedCheckout.totalPrice).toFixed(2)} ${selectedCheckout.currency}`,
                  },
                  {
                    term: "Current Status",
                    description: (
                      <Badge tone={selectedCheckout.status === "RECOVERED" ? "success" : "attention"}>
                        {selectedCheckout.status}
                      </Badge>
                    ),
                  },
                  {
                    term: "Recovery URL",
                    description: selectedCheckout.checkoutUrl ? (
                      <Link url={selectedCheckout.checkoutUrl} target="_blank">
                        {selectedCheckout.checkoutUrl}
                      </Link>
                    ) : "N/A",
                  },
                ]}
              />

              <Divider />

              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">Assignment Info</Text>
                {selectedCheckout.claimedBy ? (
                  <Text as="p">
                    Assigned to: <strong>{`${selectedCheckout.claimedBy.firstName || ""} ${selectedCheckout.claimedBy.lastName || ""}`.trim()}</strong> ({selectedCheckout.claimedBy.email})
                  </Text>
                ) : (
                  <Text as="p" tone="subdued">This checkout is being optimized for assignment to our next available specialized representative.</Text>
                )}
              </BlockStack>
            </BlockStack>
          )}
        </Modal.Section>
      </Modal>
    </Page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  let message = "Something went wrong loading checkouts.";
  if (isRouteErrorResponse(error)) {
    message = `Failed to load checkouts (${error.status} ${error.statusText}).`;
  } else if (error instanceof Error) {
    message = error.message;
  }

  return (
    <Page title="Abandoned Checkouts">
      <BlockStack gap="400">
        <Banner tone="critical" title="Unable to load abandoned checkouts">
          <p>{message}</p>
        </Banner>
      </BlockStack>
    </Page>
  );
}
