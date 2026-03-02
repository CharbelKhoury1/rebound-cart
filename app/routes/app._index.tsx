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
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

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

  const totalAbandoned = await db.abandonedCheckout.count({ where: { shop } });
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
  const commissionRate = formData.get("commissionRate");

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
  const { userRole, stats } = data as any;
  const fetcher = useFetcher();

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
  const { recentCheckouts } = data as any;
  const checkoutRows = recentCheckouts?.map((checkout: any) => [
    checkout.checkoutId.slice(-8) + "...",
    checkout.email || "N/A",
    `${checkout.totalPrice} ${checkout.currency}`,
    <Badge tone={checkout.status === "RECOVERED" ? "success" : "attention"}>
      {checkout.status}
    </Badge>,
    checkout.claimedBy ? `${checkout.claimedBy.firstName} ${checkout.claimedBy.lastName}` : "Unclaimed",
  ]) || [];

  return (
    <Page>
      <TitleBar title="Merchant Dashboard" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Grid>
              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                <Card>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingSm" tone="subdued">Total Abandoned</Text>
                    <Text as="p" variant="headingLg" fontWeight="bold">{stats.totalAbandoned}</Text>
                  </BlockStack>
                </Card>
              </Grid.Cell>
              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                <Card>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingSm" tone="subdued">Total Recovered</Text>
                    <Text as="p" variant="headingLg" fontWeight="bold" tone="success">{stats.totalRecovered}</Text>
                  </BlockStack>
                </Card>
              </Grid.Cell>
              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                <Card>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingSm" tone="subdued">Revenue Recovered (MTD)</Text>
                    <Text as="p" variant="headingLg" fontWeight="bold" tone="magic">${stats.revenueRecoveredMonth.toFixed(2)}</Text>
                  </BlockStack>
                </Card>
              </Grid.Cell>
            </Grid>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">My Store Settings</Text>
                <Text as="p">Default Rep Commission: <strong>{(data as any).settings?.commissionRate}%</strong></Text>
                <Button fullWidth url="/app/settings">Edit Settings</Button>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Recent Store Activity</Text>
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text"]}
                  headings={["Checkout ID", "Customer", "Amount", "Status", "Assigned Rep"]}
                  rows={checkoutRows}
                  hoverable
                />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}

function Box({ children, minWidth }: { children: React.ReactNode; minWidth?: string }) {
  return (
    <div style={{ flex: 1, minWidth: minWidth || "0" }}>
      {children}
    </div>
  );
}
