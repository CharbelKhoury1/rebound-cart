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

  // 3. Get recent checkouts
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
    await db.shopSettings.upsert({
      where: { shop },
      update: { commissionRate: Number(commissionRate) },
      create: { shop, commissionRate: Number(commissionRate) },
    });
  }

  return json({ success: true });
};

export default function Index() {
  const { settings, stats, recentCheckouts } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const checkoutRows = recentCheckouts.map((checkout) => [
    checkout.checkoutId,
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
          {/* Stats Section */}
          <Layout.Section>
            <InlineStack gap="400" align="start">
              <Box minWidth="200px">
                <Card>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingSm">Total Abandoned</Text>
                    <Text as="p" variant="headingLg">{stats.totalAbandoned}</Text>
                  </BlockStack>
                </Card>
              </Box>
              <Box minWidth="200px">
                <Card>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingSm">Total Recovered</Text>
                    <Text as="p" variant="headingLg">{stats.totalRecovered}</Text>
                  </BlockStack>
                </Card>
              </Box>
              <Box minWidth="200px">
                <Card>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingSm">Recovery Rate</Text>
                    <Text as="p" variant="headingLg">{stats.recoveryRate.toFixed(1)}%</Text>
                  </BlockStack>
                </Card>
              </Box>
            </InlineStack>
          </Layout.Section>

          {/* Settings Section */}
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
                  />
                  <Button submit variant="primary">Update Rate</Button>
                </BlockStack>
              </fetcher.Form>
            </Card>
          </Layout.Section>

          {/* Recent Checkouts Table */}
          <Layout.Section>
            <Card padding="0">
              <div style={{ padding: "16px" }}>
                <Text as="h2" variant="headingMd">Recent Abandoned Checkouts</Text>
              </div>
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text"]}
                headings={["Checkout ID", "Customer", "Amount", "Status", "Assigned Rep"]}
                rows={checkoutRows}
              />
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
