import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData, useFetcher } from "@remix-run/react";
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
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { syncCheckouts } from "../utils/sync.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const email = (session as any).email;

  const PLATFORM_ADMIN_EMAIL = process.env.PLATFORM_ADMIN_EMAIL || "admin@reboundcart.com";
  const isAdmin = email ? email === PLATFORM_ADMIN_EMAIL : false;

  const platformUser = email ? await db.platformUser.findUnique({
    where: { email },
  }) : null;
  const isRep = platformUser?.role === "SALES_REP" && platformUser?.status === "ACTIVE";

  // Role: Platform Admin
  if (isAdmin) {
    const [totalStores, totalReps, totalCheckouts, totalRecovered] = await Promise.all([
      db.shopSettings.count(),
      db.platformUser.count({ where: { role: "SALES_REP" } }),
      db.abandonedCheckout.count(),
      db.abandonedCheckout.count({ where: { status: "RECOVERED" } }),
    ]);

    const globalCommission = await db.commission.aggregate({
      _sum: { commissionAmount: true, platformFee: true },
    });

    return json({
      userRole: "ADMIN",
      stats: {
        totalStores,
        totalReps,
        totalCheckouts,
        totalRecovered,
        totalEarnings: Number(globalCommission._sum.commissionAmount || 0),
        platformFees: Number(globalCommission._sum.platformFee || 0),
        recoveryRate: totalCheckouts > 0 ? (totalRecovered / totalCheckouts) * 100 : 0,
      }
    });
  }

  // Role: Sales Rep
  if (isRep && platformUser) {
    const claimedCount = await db.abandonedCheckout.count({ where: { claimedById: platformUser.id } });
    const recoveredCount = await db.abandonedCheckout.count({
      where: { claimedById: platformUser.id, status: "RECOVERED" }
    });
    const commissionStats = await db.commission.aggregate({
      where: { repId: platformUser.id },
      _sum: { commissionAmount: true }
    });

    return json({
      userRole: "REP",
      salesRep: platformUser,
      stats: {
        totalCheckouts: claimedCount,
        recoveredCheckouts: recoveredCount,
        recoveryRate: claimedCount > 0 ? (recoveredCount / claimedCount) * 100 : 0,
        totalEarnings: Number(commissionStats._sum.commissionAmount || 0),
      }
    });
  }

  // Default Role: Store Owner
  let settings = await db.shopSettings.findUnique({ where: { shop } });
  if (!settings) {
    settings = await db.shopSettings.create({
      data: { shop, commissionRate: 10.0 },
    });
  }

  let totalAbandoned = await db.abandonedCheckout.count({ where: { shop } });

  // If no checkouts are found, perform an initial sync
  if (totalAbandoned === 0) {
    const { admin } = await authenticate.admin(request);
    await syncCheckouts(admin, shop);
    // Recount after sync
    totalAbandoned = await db.abandonedCheckout.count({ where: { shop } });
  }

  const totalRecovered = await db.abandonedCheckout.count({ where: { shop, status: "RECOVERED" } });
  const commissions = await db.commission.findMany({
    where: { checkout: { shop } },
    select: { commissionAmount: true },
  });
  const totalCommissionPaid = commissions.reduce((sum, c) => sum + Number(c.commissionAmount), 0);

  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const recoveredThisMonthCheckouts = await db.abandonedCheckout.findMany({
    where: { shop, status: "RECOVERED", updatedAt: { gte: firstDayOfMonth } },
    select: { totalPrice: true }
  });
  const revenueRecoveredMonth = recoveredThisMonthCheckouts.reduce((sum, c) => sum + Number(c.totalPrice), 0);

  const recentCheckouts = await db.abandonedCheckout.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { claimedBy: true },
  });

  return json({
    userRole: "OWNER",
    settings,
    stats: {
      totalAbandoned,
      totalRecovered,
      recoveryRate: totalAbandoned > 0 ? (totalRecovered / totalAbandoned) * 100 : 0,
      totalCommissionPaid,
      revenueRecoveredMonth,
    },
    recentCheckouts,
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
    const result = await syncCheckouts(admin, shop);
    const totalAbandoned = await db.abandonedCheckout.count({ where: { shop } });
    return json({ success: true, count: result.count, totalAbandoned });
  }

  if (commissionRate) {
    const rate = Number(commissionRate);

    // Validate commission rate
    if (isNaN(rate) || rate < 0 || rate > 100) {
      return json({
        success: false,
        error: "Commission rate must be a number between 0 and 100"
      }, { status: 400 });
    }

    await db.shopSettings.upsert({
      where: { shop },
      update: { commissionRate: rate },
      create: { shop, commissionRate: rate },
    });
  }

  return json({ success: true, error: undefined });
};

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const { userRole, stats, recentCheckouts, settings } = data as any;
  const fetcher = useFetcher();

  const isSyncing = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "sync";

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
    <Page fullWidth>
      <TitleBar title="ReboundCart | Merchant Workspace" />
      <BlockStack gap="600">
        {/* Premium Hero Section */}
        <Box
          padding="600"
          background="bg-surface"
          borderRadius="300"
          shadow="100"
        >
          <BlockStack gap="200">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="h1" variant="heading2xl" tone="magic">Welcome back!</Text>
                <Text as="p" variant="bodyLg" tone="subdued">
                  Your store's recovery system is active and monitoring checkouts.
                </Text>
              </BlockStack>
              <InlineStack gap="200" blockAlign="center">
                <Button
                  icon={isSyncing ? undefined : "refresh"}
                  onClick={() => fetcher.submit({ intent: "sync" }, { method: "post" })}
                  loading={isSyncing}
                  variant="tertiary"
                >
                  {isSyncing ? "Syncing..." : "Sync Now"}
                </Button>
                <div style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: "#10b981",
                  boxShadow: "0 0 0 2px rgba(16, 185, 129, 0.2)",
                  animation: "pulse 2s infinite"
                }} />
                <Badge tone="success">Live Sync Active</Badge>
              </InlineStack>
            </InlineStack>
          </BlockStack>
        </Box>

        <Layout>
          {/* Main Stats Row */}
          <Layout.Section>
            <Grid>
              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                <Card padding="500">
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingSm" tone="subdued">Abandoned</Text>
                    <Text as="p" variant="heading2xl" fontWeight="bold">{stats.totalAbandoned}</Text>
                    <div style={{ height: 4, width: "100%", background: "#f1f2f4", borderRadius: 2 }}>
                      <div style={{ height: "100%", width: "100%", background: "#6366f1", borderRadius: 2 }} />
                    </div>
                  </BlockStack>
                </Card>
              </Grid.Cell>
              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                <Card padding="500">
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingSm" tone="subdued">Recovered</Text>
                    <Text as="p" variant="heading2xl" fontWeight="bold" tone="success">{stats.totalRecovered}</Text>
                    <div style={{ height: 4, width: "100%", background: "#f1f2f4", borderRadius: 2 }}>
                      <div style={{ height: "100%", width: `${stats.recoveryRate}%`, background: "#10b981", borderRadius: 2 }} />
                    </div>
                  </BlockStack>
                </Card>
              </Grid.Cell>
              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                <Card padding="500">
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingSm" tone="subdued">Conversion Rate</Text>
                    <Text as="p" variant="heading2xl" fontWeight="bold">{stats.recoveryRate.toFixed(1)}%</Text>
                    <Text as="p" variant="bodyXs" tone="subdued">Platform Average: 12.4%</Text>
                  </BlockStack>
                </Card>
              </Grid.Cell>
              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                <Card padding="500">
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingSm" tone="subdued">Recovered Revenue</Text>
                    <Text as="p" variant="heading2xl" fontWeight="bold" tone="magic">${stats.revenueRecoveredMonth.toFixed(2)}</Text>
                    <Text as="p" variant="bodyXs" tone="subdued">This Month (MTD)</Text>
                  </BlockStack>
                </Card>
              </Grid.Cell>
            </Grid>
          </Layout.Section>

          {/* Configuration & Health */}
          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">System Status</Text>
                  <Divider />
                  <BlockStack gap="300">
                    <InlineStack align="space-between">
                      <Text as="span" tone="subdued">Commission Rate</Text>
                      <Text as="span" fontWeight="bold">{settings?.commissionRate}%</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" tone="subdued">Marketplace</Text>
                      <Badge tone={settings?.isMarketplaceEnabled ? "success" : "attention"}>
                        {settings?.isMarketplaceEnabled ? "Public" : "Private"}
                      </Badge>
                    </InlineStack>
                  </BlockStack>
                  <Button fullWidth url="/app/settings">Configuration Settings</Button>
                </BlockStack>
              </Card>

              <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingSm">Network Status</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Fully connected to the Rebound network. Data is being synced in real-time.
                  </Text>
                </BlockStack>
              </Box>
            </BlockStack>
          </Layout.Section>

          {/* Activity Table */}
          <Layout.Section>
            <Card padding="0">
              <BlockStack gap="0">
                <Box padding="400" borderBlockEndWidth="025" borderColor="border">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">Real-time Recovery Log</Text>
                    <Button variant="plain" url="/app/checkouts">View Reports</Button>
                  </InlineStack>
                </Box>
                {cRows.length === 0 ? (
                  <Box padding="800">
                    <Text as="p" alignment="center" tone="subdued">Waiting for new activity...</Text>
                  </Box>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "numeric", "text"]}
                    headings={["ID", "Customer", "Amount", "Status", "Representative"]}
                    rows={cRows as any}
                    hoverable
                  />
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
      <style dangerouslySetInnerHTML={{
        __html: `
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.4; }
          100% { opacity: 1; }
        }
      `}} />
    </Page>
  );
}
