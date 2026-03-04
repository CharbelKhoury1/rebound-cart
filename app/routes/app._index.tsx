import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData, useFetcher, useRouteError, isRouteErrorResponse } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  InlineStack,
  DataTable,
  TextField,
  Badge,
  Divider,
  Grid,
  Thumbnail,
  Icon,
  Modal,
  ChoiceList,
  FormLayout,
  Box,
  Banner,
  EmptyState,
  Toast,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { resolveUserContext } from "../services/roles.server";
import {
  getPlatformAdminDashboardStats,
  getSalesRepDashboardStats,
  getStoreOwnerDashboard,
} from "../services/checkouts.server";
import { syncShopData } from "../utils/manual-sync.server";
import { useState, useEffect } from "react";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const { userRole, platformUser } = await resolveUserContext(session as any);

  if (userRole === "ADMIN") {
    const stats = await getPlatformAdminDashboardStats();
    return json({ userRole, stats });
  }

  if (userRole === "REP" && platformUser) {
    const stats = await getSalesRepDashboardStats(platformUser.id);
    return json({
      userRole,
      salesRep: platformUser,
      stats,
    });
  }

  // Default Role: Store Owner
  let totalAbandoned = await getStoreOwnerDashboard(shop).then(
    (data) => data.stats.totalAbandoned,
  );

  // If no checkouts are found, perform an initial sync
  if (totalAbandoned === 0) {
    const { admin } = await authenticate.admin(request);
    await syncShopData(admin, shop);
    // Recount after sync
    totalAbandoned = await getStoreOwnerDashboard(shop).then(
      (data) => data.stats.totalAbandoned,
    );
  }

  const ownerDashboard = await getStoreOwnerDashboard(shop);

  return json({
    userRole: "OWNER",
    settings: ownerDashboard.settings,
    stats: ownerDashboard.stats,
    recentCheckouts: ownerDashboard.recentCheckouts,
    topReps: ownerDashboard.topReps,
    setupComplete: ownerDashboard.setupComplete,
    recentEvents: [
      { id: 1, type: "claim", rep: "Sarah J.", amount: "$120.00", time: "5m ago" },
      { id: 2, type: "recovery", rep: "Mike D.", amount: "$85.50", time: "12m ago" },
      { id: 3, type: "contact", rep: "Alex P.", amount: "$450.00", time: "1h ago" },
    ],
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");
  const commissionRate = formData.get("commissionRate");

  if (intent === "sync") {
    const { admin } = await authenticate.admin(request);
    const result = await syncShopData(admin, shop);
    const totalAbandoned = await db.abandonedCheckout.count({ where: { shop } });
    return json({ success: true, count: result.syncedCount, totalAbandoned, message: result.message, errors: result.errors });
  }

  return json({ success: true, error: undefined });
};

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { userRole, stats, recentCheckouts, settings, topReps, setupComplete, recentEvents } = data as any;
  const fetcher = useFetcher();
  const [toastActive, setToastActive] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastError, setToastError] = useState(false);

  const isSyncing = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "sync";

  // Show toast when sync completes
  useEffect(() => {
    if (actionData && (actionData as any).success && (actionData as any).message) {
      setToastMessage((actionData as any).message);
      setToastError(false);
      setToastActive(true);
    } else if (actionData && (actionData as any).error) {
      setToastMessage((actionData as any).error);
      setToastError(true);
      setToastActive(true);
    }
  }, [actionData]);

  const toggleToast = () => setToastActive(!toastActive);

  // ── ADMIN VIEW ───────────────────────────────────────────────
  if (userRole === "ADMIN") {
    return (
      <Page>
        <TitleBar title="Platform Admin Dashboard" />
        <BlockStack gap="500">
          <Layout>
            <Layout.Section>
              <Grid>
                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                  <Card>
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">Total Stores</Text>
                      <Text as="p" variant="headingLg" fontWeight="bold">{stats.totalStores}</Text>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                  <Card>
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">Active Reps</Text>
                      <Text as="p" variant="headingLg" fontWeight="bold">{stats.totalReps}</Text>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                  <Card>
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">Platform Revenue</Text>
                      <Text as="p" variant="headingLg" fontWeight="bold" tone="success">${stats.totalEarnings.toFixed(2)}</Text>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                  <Card>
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">Fees Collected</Text>
                      <Text as="p" variant="headingLg" fontWeight="bold" tone="magic">${stats.platformFees.toFixed(2)}</Text>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
              </Grid>
            </Layout.Section>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Platform Health</Text>
                  <Text as="p">Overall Recovery Rate: <strong>{stats.recoveryRate.toFixed(1)}%</strong></Text>
                  <InlineStack gap="300">
                    <Button url="/app/platform-admin/users">Manage Users</Button>
                    <Button url="/app/platform-admin/checkouts">Audit Checkouts</Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        </BlockStack>
      </Page>
    );
  }

  // ── REP VIEW ───────────────────────────────────────────────
  if (userRole === "REP") {
    return (
      <Page>
        <TitleBar title="Representative Workspace" />
        <BlockStack gap="500">
          <Layout>
            <Layout.Section>
              <Grid>
                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                  <Card>
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">My Recoveries</Text>
                      <Text as="p" variant="headingLg" fontWeight="bold">{stats.recoveredCheckouts}</Text>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                  <Card>
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">My Earnings</Text>
                      <Text as="p" variant="headingLg" fontWeight="bold" tone="success">${stats.totalEarnings.toFixed(2)}</Text>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                  <Card>
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">Efficiency</Text>
                      <Text as="p" variant="headingLg" fontWeight="bold">{stats.recoveryRate.toFixed(1)}%</Text>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
              </Grid>
            </Layout.Section>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Ready to work?</Text>
                  <Text as="p">You have {stats.totalCheckouts} active checkouts to follow up on.</Text>
                  <Button variant="primary" url="/app/rep-dashboard">Go to Recovery Workspace</Button>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        </BlockStack>
      </Page>
    );
  }

  // ── OWNER VIEW (Current Store Admin) ───────────────────────────
  const cRows = recentCheckouts?.map((checkout: any) => [
    checkout.checkoutId.slice(-8) + "...",
    checkout.email || "N/A",
    `${checkout.totalPrice} ${checkout.currency}`,
    <Badge key={checkout.id} tone={checkout.status === "RECOVERED" ? "success" : "attention"}>
      {checkout.status}
    </Badge>,
    checkout.claimedBy ? `${checkout.claimedBy.firstName} ${checkout.claimedBy.lastName}` : "Marketplace",
  ]) || [];

  return (
    <Page
      title="Dashboard"
      primaryAction={{
        content: isSyncing ? "Syncing..." : "Sync Store Data",
        onAction: () => fetcher.submit({ intent: "sync" }, { method: "post" }),
        loading: isSyncing,
      }}
      secondaryActions={[
        {
          content: "View All Checkouts",
          url: "/app/checkouts"
        },
        {
          content: "Manual Sync",
          url: "/app/sync"
        }
      ]}
    >
      <BlockStack gap="500">
        {!setupComplete && (
          <Banner
            title="Complete your setup to start recovering revenue"
            tone="info"
            onDismiss={() => { }}
          >
            <p>Sync your checkouts and set your commission rate to activate the Rebound representative network.</p>
          </Banner>
        )}

        <Layout>
          {/* Row 1: Unified Outcome Metrics */}
          <Layout.Section>
            <Grid>
              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3 }}>
                <Card>
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingSm" tone="subdued">Total Abandoned</Text>
                    <Text as="p" variant="heading2xl" fontWeight="bold">{stats.totalAbandoned}</Text>
                  </BlockStack>
                </Card>
              </Grid.Cell>
              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3 }}>
                <Card>
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingSm" tone="subdued">Recovered</Text>
                    <Text as="p" variant="heading2xl" fontWeight="bold" tone="success">{stats.totalRecovered || 0}</Text>
                  </BlockStack>
                </Card>
              </Grid.Cell>
              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3 }}>
                <Card>
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingSm" tone="subdued">Pending Claims</Text>
                    <Text as="p" variant="heading2xl" fontWeight="bold" tone="caution">{stats.pendingClaimsCount || 0}</Text>
                  </BlockStack>
                </Card>
              </Grid.Cell>
              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3 }}>
                <Card>
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingSm" tone="subdued">Net Profit (ROI)</Text>
                    <Text as="p" variant="heading2xl" fontWeight="bold" tone="success">
                      +${(stats.revenueRecoveredMonth - stats.totalCommissionPaid).toFixed(0)}
                    </Text>
                  </BlockStack>
                </Card>
              </Grid.Cell>
            </Grid>
          </Layout.Section>

          {/* Row 2: Full-Width Clean Table Card */}
          <Layout.Section>
            <Card padding="0">
              <Box padding="400" borderBlockEndWidth="025" borderColor="border">
                <Text as="h2" variant="headingMd">My Store's Recent Activity</Text>
              </Box>
              {cRows.length === 0 ? (
                <EmptyState
                  heading="No recovery activity yet"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>Once representatives start claiming carts, they will appear here.</p>
                </EmptyState>
              ) : (
                <DataTable
                  columnContentTypes={["text", "text", "text", "numeric", "text"]}
                  headings={["ID", "Customer", "Amount", "Status", "Representative"]}
                  rows={cRows as any}
                />
              )}
            </Card>
          </Layout.Section>

          {/* Row 3: Balanced Info Blocks */}
          <Layout.Section variant="oneThird">
            <Card padding="400">
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">System Status</Text>
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">Monitoring</Text>
                    <Badge tone="success">Live</Badge>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">Commission</Text>
                    <Text as="span" fontWeight="bold">{settings?.commissionRate}%</Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">Network Access</Text>
                    <Badge tone="info">{settings?.isMarketplaceEnabled ? "Public" : "Private"}</Badge>
                  </InlineStack>
                </BlockStack>
                <Divider />
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">AI Tip</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Rates increase by 20% when carts are claimed within 30 minutes.
                  </Text>
                </BlockStack>
                <Button fullWidth url="/app/settings">Configuration Settings</Button>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card padding="400">
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Top Representatives</Text>
                <BlockStack gap="300">
                  {topReps && topReps.length > 0 ? topReps.slice(0, 3).map((rep: any, i: number) => (
                    <InlineStack key={i} align="space-between">
                      <Text as="span" fontWeight="bold">{rep.firstName} {rep.lastName?.charAt(0)}.</Text>
                      <Badge tone={rep.tier === "PLATINUM" ? "magic" : "info"}>{rep.tier}</Badge>
                    </InlineStack>
                  )) : (
                    <Text as="p" tone="subdued">Connecting to Rebound...</Text>
                  )}
                </BlockStack>

              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card padding="400">
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Global Pulse</Text>
                <BlockStack gap="200">
                  {recentEvents && recentEvents.length > 0 ? recentEvents.slice(0, 3).map((event: any) => (
                    <Text key={event.id} as="p" variant="bodySm" tone="subdued">
                      <strong>{event.rep}</strong> recovered a {event.amount} cart {event.time}.
                    </Text>
                  )) : (
                    <Text as="p" tone="subdued">Scanning global events...</Text>
                  )}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* How it Works - Flywheel Reintegration */}
        <Box paddingBlockStart="800" paddingBlockEnd="800">
          <Card background="bg-surface-secondary">
            <BlockStack gap="600">
              <Text as="h2" variant="headingLg" alignment="center">How the Rebound Flywheel Works</Text>
              <Grid>
                <Grid.Cell columnSpan={{ xs: 6, md: 4 }}>
                  <BlockStack gap="200" align="center">
                    <div style={{ fontSize: "32px" }}>🛒</div>
                    <Text as="h3" variant="headingMd" alignment="center">1. Cart Abandonment</Text>
                    <Text as="p" tone="subdued" alignment="center">Shopify trigger detected and synced in real-time.</Text>
                  </BlockStack>
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, md: 4 }}>
                  <BlockStack gap="200" align="center">
                    <div style={{ fontSize: "32px" }}>👥</div>
                    <Text as="h3" variant="headingMd" alignment="center">2. Rep Assignment</Text>
                    <Text as="p" tone="subdued" alignment="center">A top sales rep claims the cart and begins outreach.</Text>
                  </BlockStack>
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, md: 4 }}>
                  <BlockStack gap="200" align="center">
                    <div style={{ fontSize: "32px" }}>💸</div>
                    <Text as="h3" variant="headingMd" alignment="center">3. Revenue Recovery</Text>
                    <Text as="p" tone="subdued" alignment="center">You get the sale, the rep gets a small commission.</Text>
                  </BlockStack>
                </Grid.Cell>
              </Grid>
            </BlockStack>
          </Card>
        </Box>
      </BlockStack>

      {/* Toast Notification */}
      {toastActive && (
        <Toast
          content={toastMessage}
          error={toastError}
          onDismiss={toggleToast}
        />
      )}
    </Page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  let message = "Something went wrong loading your dashboard.";
  if (isRouteErrorResponse(error)) {
    message = `Failed to load dashboard (${error.status} ${error.statusText}).`;
  } else if (error instanceof Error) {
    message = error.message;
  }

  return (
    <Page title="Dashboard">
      <BlockStack gap="400">
        <Banner tone="critical" title="Unable to load dashboard">
          <p>{message}</p>
        </Banner>
      </BlockStack>
    </Page>
  );
}
