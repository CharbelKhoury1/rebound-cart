import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
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
  Grid,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { requirePlatformAdmin } from "../services/roles.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  requirePlatformAdmin(session as any);

  // Get cross-store platform stats
  const [totalStores, totalReps, totalCheckouts, totalRecovered] = await Promise.all([
    db.shopSettings.count(),
    db.platformUser.count({ where: { role: "SALES_REP" } }),
    db.abandonedCheckout.count(),
    db.abandonedCheckout.count({ where: { status: "RECOVERED" } }),
  ]);

  const totalCommission = await db.commission.aggregate({
    _sum: { commissionAmount: true },
  });

  const recentApplications = await db.platformUser.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const topPerformers = await db.platformUser.findMany({
    where: { role: "SALES_REP", status: "ACTIVE" },
    include: {
      claimedCheckouts: {
        select: { id: true },
      },
      commissions: {
        select: { commissionAmount: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  // Calculate performance metrics
  const performersWithStats = topPerformers.map((rep: any) => ({
    ...rep,
    totalCheckouts: rep.claimedCheckouts?.length || 0,
    totalEarnings: rep.commissions?.reduce((sum: number, c: any) => sum + Number(c.commissionAmount), 0) || 0,
  }));

  return json({
    platformStats: {
      totalStores,
      totalReps,
      totalCheckouts,
      totalRecovered,
      totalCommission: totalCommission._sum?.commissionAmount || 0,
      recoveryRate: totalCheckouts > 0 ? (totalRecovered / totalCheckouts) * 100 : 0,
    },
    recentApplications,
    topPerformers: performersWithStats.sort((a: any, b: any) => b.totalEarnings - a.totalEarnings).slice(0, 5),
  });
};

export default function PlatformAdminIndex() {
  const { platformStats, recentApplications, topPerformers } = useLoaderData<typeof loader>();

  const applicationRows = recentApplications.map((app: any) => [
    `${app.firstName} ${app.lastName}`,
    app.email,
    <Badge tone="warning">PENDING</Badge>,
    app.tier || "BRONZE",
    new Date(app.createdAt).toLocaleDateString(),
  ]);

  const performerRows = topPerformers.map((rep: any) => [
    `${rep.firstName} ${rep.lastName}`,
    rep.email,
    <Badge tone={rep.tier === "PLATINUM" ? "magic" : rep.tier === "GOLD" ? "warning" : rep.tier === "SILVER" ? "attention" : "new"}>
      {rep.tier || "BRONZE"}
    </Badge>,
    rep.totalCheckouts.toString(),
    `$${rep.totalEarnings.toFixed(2)}`,
    new Date(rep.createdAt).toLocaleDateString(),
  ]);

  return (
    <Page>
      <TitleBar title="Platform Admin Dashboard" />
      
      <BlockStack gap="500">
        <Layout>
          {/* Platform Overview Stats */}
          <Layout.Section>
            <Grid>
              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                <Card>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingSm" tone="subdued">Total Stores</Text>
                    <Text as="p" variant="headingLg" fontWeight="bold">{platformStats.totalStores}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Active merchants</Text>
                  </BlockStack>
                </Card>
              </Grid.Cell>
              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                <Card>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingSm" tone="subdued">Active Sales Reps</Text>
                    <Text as="p" variant="headingLg" fontWeight="bold">{platformStats.totalReps}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">On platform</Text>
                  </BlockStack>
                </Card>
              </Grid.Cell>
              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                <Card>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingSm" tone="subdued">Total Checkouts</Text>
                    <Text as="p" variant="headingLg" fontWeight="bold">{platformStats.totalCheckouts}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Across all stores</Text>
                  </BlockStack>
                </Card>
              </Grid.Cell>
              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                <Card>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingSm" tone="subdued">Platform Recovery Rate</Text>
                    <Text as="p" variant="headingLg" fontWeight="bold">{platformStats.recoveryRate.toFixed(1)}%</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Cross-store average</Text>
                  </BlockStack>
                </Card>
              </Grid.Cell>
              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                <Card>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingSm" tone="subdued">Total Commission</Text>
                    <Text as="p" variant="headingLg" fontWeight="bold" tone="magic">${platformStats.totalCommission.toFixed(2)}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Platform revenue</Text>
                  </BlockStack>
                </Card>
              </Grid.Cell>
            </Grid>
          </Layout.Section>

          {/* Recent Applications */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">Recent Applications</Text>
                  <Button variant="plain" url="/app/platform-admin/applications">View All →</Button>
                </InlineStack>
                <DataTable
                  columnContentTypes={["text", "text", "text", "text"]}
                  headings={["Name", "Email", "Status", "Tier", "Applied"]}
                  rows={applicationRows}
                  hoverable
                />
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Top Performers */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Top Performers</Text>
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text", "text"]}
                  headings={["Name", "Email", "Tier", "Checkouts", "Earnings", "Joined"]}
                  rows={performerRows}
                  hoverable
                />
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Quick Actions */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Platform Management</Text>
                <InlineStack gap="200">
                  <Button variant="plain" url="/app/platform-admin/users">Manage Users</Button>
                  <Button variant="plain" url="/app/platform-admin/applications">Review Applications</Button>
                  <Button variant="plain" url="/app/platform-admin/commissions">Commissions</Button>
                  <Button variant="plain" url="/app/platform-admin/analytics">Analytics</Button>
                  <Button variant="plain" url="/app/platform-admin/checkouts">All Checkouts</Button>
                  <Button variant="plain" url="/app/platform-admin/stores">Store Management</Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
