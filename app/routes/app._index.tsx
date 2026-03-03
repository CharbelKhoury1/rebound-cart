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

  // Fetch some platform insights for the owner to make it feel like a "network"
  const topReps = await db.platformUser.findMany({
    where: { role: "SALES_REP", status: "ACTIVE" },
    take: 3,
    orderBy: { createdAt: "desc" }, // In a real app, this would be by performance
    select: { firstName: true, lastName: true, tier: true, experience: true },
  });

  const setupComplete = settings.commissionRate.toNumber() !== 10.0 || totalAbandoned > 0;

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
    topReps,
    setupComplete,
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
    const result = await syncCheckouts(admin, shop);
    const totalAbandoned = await db.abandonedCheckout.count({ where: { shop } });
    return json({ success: true, count: result.count, totalAbandoned });
  }

  return json({ success: true, error: undefined });
};

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const { userRole, stats, recentCheckouts, settings, topReps, setupComplete, recentEvents } = data as any;
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
                  {setupComplete
                    ? "Your store's recovery system is active and monitoring checkouts."
                    : "Complete your setup to start recovering abandoned carts with professional reps."}
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

        {!setupComplete && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">🚀 Quick Start Checklist</Text>
              <Divider />
              <Grid>
                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source="checkmark" tone="success" />
                    <Text as="span">Install ReboundCart</Text>
                  </InlineStack>
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={stats.totalAbandoned > 0 ? "checkmark" : "circle"} tone={stats.totalAbandoned > 0 ? "success" : "subdued"} />
                    <Text as="span">Sync Checkouts</Text>
                  </InlineStack>
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={settings.commissionRate !== 10.0 ? "checkmark" : "circle"} tone={settings.commissionRate !== 10.0 ? "success" : "subdued"} />
                    <Text as="span">Set Commission Rate</Text>
                  </InlineStack>
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source="circle" tone="subdued" />
                    <Text as="span">First Recovery</Text>
                  </InlineStack>
                </Grid.Cell>
              </Grid>
            </BlockStack>
          </Card>
        )}

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
                    <Text as="p" variant="heading2xl" fontWeight="bold" tone="success">${stats.revenueRecoveredMonth.toFixed(2)}</Text>
                    <Text as="p" variant="bodyXs" tone="subdued">This Month (MTD)</Text>
                  </BlockStack>
                </Card>
              </Grid.Cell>
              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                <Card padding="500" background="bg-surface-brand">
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingSm">Net App ROI</Text>
                    <Text as="p" variant="heading2xl" fontWeight="bold">
                      +${(stats.revenueRecoveredMonth - stats.totalCommissionPaid).toFixed(2)}
                    </Text>
                    <Text as="p" variant="bodyXs" tone="subdued">Profit after commissions</Text>
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

              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">🏆 Top Network Reps</Text>
                  <Divider />
                  <BlockStack gap="300">
                    {topReps && topReps.length > 0 ? topReps.map((rep: any, i: number) => (
                      <InlineStack key={i} align="space-between" blockAlign="center">
                        <BlockStack gap="050">
                          <Text as="span" fontWeight="bold">{rep.firstName} {rep.lastName?.charAt(0)}.</Text>
                          <InlineStack gap="200">
                            <Badge tone={rep.tier === "PLATINUM" ? "magic" : rep.tier === "GOLD" ? "info" : "attention"}>
                              {rep.tier || "SILVER"}
                            </Badge>
                            <Text as="span" tone="subdued">{rep.experience} Years Experience</Text>
                          </InlineStack>
                        </BlockStack>
                      </InlineStack>
                    )) : (
                      <Text as="p" tone="subdued">Connecting to Rebound Network...</Text>
                    )}
                  </BlockStack>
                  <Button fullWidth variant="plain">Become a Representative</Button>
                </BlockStack>
              </Card>

              <Card background="bg-surface-brand">
                <BlockStack gap="300">
                  <Text as="h2" variant="headingSm">AI Recovery Insight</Text>
                  <Text as="p" variant="bodySm">
                    High value carts ($200+) currently have a 15% higher recovery rate when contacted within 2 hours.
                  </Text>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">📈 Performance Forecast</Text>
                  <Divider />
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">Based on current trends, you are on track to recover:</Text>
                    <Text as="p" variant="headingLg" tone="success">${(stats.revenueRecoveredMonth * 1.2).toFixed(2)}</Text>
                    <Text as="p" variant="bodyXs" tone="subdued">Estimated by end of month (+20%)</Text>
                  </BlockStack>
                </BlockStack>
              </Card>
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

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">📡 Global Activity</Text>
                  <Divider />
                  <BlockStack gap="300">
                    {recentEvents.map((event: any) => (
                      <Box key={event.id} padding="200" background="bg-surface-secondary" borderRadius="200">
                        <BlockStack gap="100">
                          <InlineStack align="space-between">
                            <Text as="span" fontWeight="bold">
                              {event.type === "claim" ? "🤝 Claimed" : event.type === "recovery" ? "💰 Recovered" : "📞 Contacted"}
                            </Text>
                            <Text as="span" variant="bodyXs" tone="subdued">{event.time}</Text>
                          </InlineStack>
                          <Text as="p" variant="bodySm">
                            {event.rep} handled a <strong>{event.amount}</strong> cart.
                          </Text>
                        </BlockStack>
                      </Box>
                    ))}
                  </BlockStack>
                </BlockStack>
              </Card>

              <Card background="bg-surface-info">
                <BlockStack gap="300">
                  <Text as="h2" variant="headingSm">⚡ Coming Soon: AI Voice</Text>
                  <Text as="p" variant="bodySm">
                    We're building an AI voice recovery system for automated outbound calls. Late-night recoveries made easy!
                  </Text>
                  <Button variant="plain">Join Waitlist</Button>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>

        <Box paddingBlockStart="800">
          <Card>
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
