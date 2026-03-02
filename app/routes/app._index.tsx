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

  // Calculate Revenue Recovered This Month
  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const recoveredThisMonthCheckouts = await db.abandonedCheckout.findMany({
    where: {
      shop,
      status: "RECOVERED",
      updatedAt: { gte: firstDayOfMonth }
    },
    select: { totalPrice: true }
  });
  const revenueRecoveredMonth = recoveredThisMonthCheckouts.reduce((sum, c) => sum + Number(c.totalPrice), 0);

  // 3. Get recent checkouts for THIS STORE ONLY
  const recentCheckouts = await db.abandonedCheckout.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { claimedBy: true },
  });

  return json({
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
  const { settings, stats, recentCheckouts } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const actionData = useActionData<typeof action>();

  const checkoutRows = recentCheckouts.map((checkout: any) => [
    checkout.checkoutId.slice(-8) + "...", // Shortened ID for display
    checkout.email || "N/A",
    `${checkout.totalPrice} ${checkout.currency}`,
    <Badge tone={checkout.status === "RECOVERED" ? "success" : "attention"}>
      {checkout.status}
    </Badge>,
    checkout.claimedBy ? `${checkout.claimedBy.firstName} ${checkout.claimedBy.lastName}` : "Unclaimed",
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
              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 6, xl: 6 }}>
                <Card>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingSm" tone="subdued">Revenue Recovered (MTD)</Text>
                    <Text as="p" variant="headingLg" fontWeight="bold" tone="magic">${stats.revenueRecoveredMonth.toFixed(2)}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Month to date earnings</Text>
                  </BlockStack>
                </Card>
              </Grid.Cell>
              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 6, xl: 6 }}>
                <Card>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingSm" tone="subdued">Commission Paid</Text>
                    <Text as="p" variant="headingLg" fontWeight="bold">${stats.totalCommissionPaid.toFixed(2)}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Total to sales reps</Text>
                  </BlockStack>
                </Card>
              </Grid.Cell>
            </Grid>
          </Layout.Section>

          {/* Quick Actions Section */}
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Quick Actions</Text>
                <Button variant="plain" fullWidth textAlign="left" url="/app/checkouts">View My Checkouts</Button>
                <Button variant="plain" fullWidth textAlign="left" url="/app/analytics">Recovery Analytics</Button>
                <Button variant="plain" fullWidth textAlign="left" url="/app/settings">Store Settings</Button>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Recent Checkouts Table */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">My Recent Abandoned Checkouts</Text>
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
