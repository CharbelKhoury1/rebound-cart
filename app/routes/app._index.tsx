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

  // 1. Get or create shop settings
  let settings = await db.shopSettings.findUnique({ where: { shop } });
  if (!settings) {
    settings = await db.shopSettings.create({
      data: { shop, commissionRate: 10.0 },
    });
  }

  // 2. Get stats
  const totalAbandoned = await db.abandonedCheckout.count({ where: { shop } });
  const totalRecovered = await db.abandonedCheckout.count({
    where: { shop, status: "RECOVERED" },
  });

  const commissions = await db.commission.findMany({
    where: { checkout: { shop } },
    select: { commissionAmount: true },
  });
  const totalCommissionPaid = commissions.reduce((sum: number, c: any) => sum + Number(c.commissionAmount), 0);

  // 3. Get recent checkouts, sales reps, and platform users
  const recentCheckouts = await db.abandonedCheckout.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { claimedBy: true },
  });

  const salesReps = await db.salesRep.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const platformUsers = await db.platformUser.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
    include: {
      claimedCheckouts: { select: { id: true } },
      commissions: { select: { commissionAmount: true } },
    },
  });

  return json({
    settings,
    stats: {
      totalAbandoned,
      totalRecovered,
      recoveryRate: totalAbandoned > 0 ? (totalRecovered / totalAbandoned) * 100 : 0,
      totalCommissionPaid,
    },
    recentCheckouts,
    salesReps,
    platformUsers,
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
  const { settings, stats, recentCheckouts, salesReps, platformUsers } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const actionData = useActionData<typeof action>();

  const checkoutRows = recentCheckouts.map((checkout) => [
    checkout.checkoutId.slice(-8) + "...", // Shortened ID for display
    checkout.email || "N/A",
    `${checkout.totalPrice} ${checkout.currency}`,
    <Badge tone={checkout.status === "RECOVERED" ? "success" : "attention"}>
      {checkout.status}
    </Badge>,
    checkout.claimedBy ? `${checkout.claimedBy.firstName} ${checkout.claimedBy.lastName}` : "Unclaimed",
  ]);

  const repRows = salesReps.map((rep) => [
    `${rep.firstName} ${rep.lastName}`,
    rep.email,
    <Badge tone={rep.role === "ADMIN" ? "info" as const : "success" as const}>{rep.role}</Badge>,
    new Date(rep.createdAt).toLocaleDateString(),
  ]);

  const platformUserRows = platformUsers.map((user: any) => [
    `${user.firstName || ""} ${user.lastName || ""}`.trim() || "—",
    user.email,
    <Badge tone={user.role === "PLATFORM_ADMIN" ? "info" as const : "success" as const}>
      {user.role === "PLATFORM_ADMIN" ? "Admin" : "Sales Rep"}
    </Badge>,
    <Badge tone={
      user.tier === "PLATINUM" ? "magic" as const :
        user.tier === "GOLD" ? "warning" as const :
          user.tier === "SILVER" ? "attention" as const :
            "new" as const
    }>
      {user.tier || "BRONZE"}
    </Badge>,
    <Badge tone={user.status === "ACTIVE" ? "success" as const : user.status === "PENDING" ? "warning" as const : user.status === "SUSPENDED" ? "attention" as const : "critical" as const}>
      {user.status}
    </Badge>,
  ]);

  return (
    <Page>
      <TitleBar title="ReboundCart Dashboard" />
      <BlockStack gap="500">
        <Layout>
          {/* Enhanced Stats Section */}
          <Layout.Section>
            <Grid>
              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                <Card>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingSm" tone="subdued">Total Abandoned</Text>
                    <Text as="p" variant="headingLg" fontWeight="bold">{stats.totalAbandoned}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Checkouts left behind</Text>
                  </BlockStack>
                </Card>
              </Grid.Cell>
              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                <Card>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingSm" tone="subdued">Total Recovered</Text>
                    <Text as="p" variant="headingLg" fontWeight="bold" tone="success">{stats.totalRecovered}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Successfully converted</Text>
                  </BlockStack>
                </Card>
              </Grid.Cell>
              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                <Card>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingSm" tone="subdued">Recovery Rate</Text>
                    <Text as="p" variant="headingLg" fontWeight="bold">{stats.recoveryRate.toFixed(1)}%</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Conversion success rate</Text>
                  </BlockStack>
                </Card>
              </Grid.Cell>
              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
                <Card>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingSm" tone="subdued">Commission Paid</Text>
                    <Text as="p" variant="headingLg" fontWeight="bold" tone="magic">${stats.totalCommissionPaid.toFixed(2)}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Total to sales reps</Text>
                  </BlockStack>
                </Card>
              </Grid.Cell>
            </Grid>
          </Layout.Section>

          {/* Enhanced Settings Section */}
          <Layout.Section variant="oneThird">
            <Card>
              <fetcher.Form method="POST">
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Commission Settings</Text>
                  <TextField
                    label="Commission Rate (%)"
                    name="commissionRate"
                    type="number"
                    value={settings.commissionRate.toString()}
                    autoComplete="off"
                    suffix="%"
                    onChange={() => { }}
                    error={actionData && 'error' in actionData ? actionData.error : undefined}
                    helpText="Set the commission percentage for sales reps"
                  />
                  <Button submit variant="primary" size="large">Update Rate</Button>
                </BlockStack>
              </fetcher.Form>
            </Card>

            <Divider />

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Quick Actions</Text>
                <Button variant="plain" fullWidth textAlign="left" url="/app/sales-reps">Manage Sales Reps</Button>
                <Button variant="plain" fullWidth textAlign="left" url="/app/platform-users">Platform Users</Button>
                <Button variant="plain" fullWidth textAlign="left" url="/app/checkouts">View All Checkouts</Button>
                <Button variant="plain" fullWidth textAlign="left" url="/app/commissions">Commissions & Payouts</Button>
                <Button variant="plain" fullWidth textAlign="left" url="/app/analytics">Analytics & Insights</Button>
                <Button variant="plain" fullWidth textAlign="left" url="/app/admin-approvals">Pending Applications</Button>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Enhanced Recent Checkouts Table */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Recent Abandoned Checkouts</Text>
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text"]}
                  headings={["Checkout ID", "Customer", "Amount", "Status", "Assigned Rep"]}
                  rows={checkoutRows}
                  hoverable
                />
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Sales Reps Table */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Sales Team</Text>
                <DataTable
                  columnContentTypes={["text", "text", "text", "text"]}
                  headings={["Name", "Email", "Role", "Joined"]}
                  rows={repRows}
                  hoverable
                />
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Platform Users Preview Table */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">Platform Users (Recent)</Text>
                  <Button variant="plain" url="/app/platform-users">View all →</Button>
                </InlineStack>
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text"]}
                  headings={["Name", "Email", "Role", "Tier", "Status"]}
                  rows={platformUserRows}
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
