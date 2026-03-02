import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
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
    Box,
    Divider,
} from "@shopify/polaris";
import db from "../db.server";
import { getSession, destroySession } from "../sessions.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const session = await getSession(request.headers.get("Cookie"));
    if (!session.has("userId") || session.get("userRole") !== "PLATFORM_ADMIN") {
        return redirect("/portal");
    }

    const [totalStores, totalReps, totalCheckouts, totalRecovered] = await Promise.all([
        db.shopSettings.count(),
        db.platformUser.count({ where: { role: "SALES_REP" } }),
        db.abandonedCheckout.count(),
        db.abandonedCheckout.count({ where: { status: "RECOVERED" } }),
    ]);

    const globalCommission = await db.commission.aggregate({
        _sum: { commissionAmount: true, platformFee: true },
    });

    const recentStores = await db.shopSettings.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
    });

    return json({
        stats: {
            totalStores,
            totalReps,
            totalCheckouts,
            totalRecovered,
            totalRevenue: Number(globalCommission._sum.commissionAmount || 0) * 10, // Mock calc
            totalFees: Number(globalCommission._sum.platformFee || 0),
        },
        recentStores,
    });
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const session = await getSession(request.headers.get("Cookie"));
    if (!session.has("userId")) return json({ error: "Unauthorized" }, { status: 401 });
    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "logout") {
        return redirect("/portal", {
            headers: {
                "Set-Cookie": await destroySession(session),
            },
        });
    }

    return json({ success: false, error: "Invalid action" }, { status: 400 });
};

export default function AdminPortalDashboard() {
    const { stats, recentStores } = useLoaderData<typeof loader>();
    const fetcher = useFetcher();

    const storeRows = recentStores.map((store: any) => [
        store.shop,
        `${store.commissionRate}%`,
        store.isMarketplaceEnabled ? <Badge tone="success">Public</Badge> : <Badge tone="attention">Private</Badge>,
        new Date(store.createdAt).toLocaleDateString(),
    ]);

    return (
        <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
            <Box background="bg-surface" padding="400" borderBlockEndWidth="025">
                <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="400" blockAlign="center">
                        <Text as="h1" variant="headingLg">ReboundCart | Platform Admin</Text>
                        <Badge tone="magic">Control Center</Badge>
                    </InlineStack>
                    <InlineStack gap="200">
                        <Text as="p" variant="bodyMd">Administrator</Text>
                        <fetcher.Form method="post">
                            <input type="hidden" name="intent" value="logout" />
                            <Button size="slim" variant="plain" submit>Logout</Button>
                        </fetcher.Form>
                    </InlineStack>
                </InlineStack>
            </Box>

            <Page fullWidth>
                <BlockStack gap="500">
                    <Layout>
                        <Layout.Section>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
                                <Card>
                                    <BlockStack gap="100">
                                        <Text as="p" variant="bodySm" tone="subdued">Active Stores</Text>
                                        <Text as="p" variant="headingLg" fontWeight="bold">{stats.totalStores}</Text>
                                    </BlockStack>
                                </Card>
                                <Card>
                                    <BlockStack gap="100">
                                        <Text as="p" variant="bodySm" tone="subdued">Sales Representatives</Text>
                                        <Text as="p" variant="headingLg" fontWeight="bold">{stats.totalReps}</Text>
                                    </BlockStack>
                                </Card>
                                <Card>
                                    <BlockStack gap="100">
                                        <Text as="p" variant="bodySm" tone="subdued">Recovered Orders</Text>
                                        <Text as="p" variant="headingLg" tone="success" fontWeight="bold">{stats.totalRecovered}</Text>
                                    </BlockStack>
                                </Card>
                                <Card>
                                    <BlockStack gap="100">
                                        <Text as="p" variant="bodySm" tone="subdued">Platform Revenue (Fees)</Text>
                                        <Text as="p" variant="headingLg" tone="magic" fontWeight="bold">${stats.totalFees.toFixed(2)}</Text>
                                    </BlockStack>
                                </Card>
                            </div>
                        </Layout.Section>

                        <Layout.Section>
                            <BlockStack gap="500">
                                <Card>
                                    <BlockStack gap="400">
                                        <Text as="h2" variant="headingMd">Platform Overview</Text>
                                        <Divider />
                                        <Box paddingBlock="200">
                                            <Text as="p">Throughput Metrics: {stats.totalCheckouts} Checkouts Detected</Text>
                                            <Text as="p">Efficiency: {((stats.totalRecovered / (stats.totalCheckouts || 1)) * 100).toFixed(1)}% Conversion</Text>
                                        </Box>
                                    </BlockStack>
                                </Card>

                                <Card>
                                    <BlockStack gap="400">
                                        <Text as="h2" variant="headingMd">Recently Connected Stores</Text>
                                        <DataTable
                                            columnContentTypes={["text", "text", "text", "text"]}
                                            headings={["Shop Domain", "Commission Rate", "Status", "Joined On"]}
                                            rows={storeRows}
                                            hoverable
                                        />
                                    </BlockStack>
                                </Card>
                            </BlockStack>
                        </Layout.Section>

                        <Layout.Section variant="oneThird">
                            <Card>
                                <BlockStack gap="400">
                                    <Text as="h2" variant="headingMd">Quick Actions</Text>
                                    <Button fullWidth size="large">Approve New Reps</Button>
                                    <Button fullWidth size="large">Review QC Warnings</Button>
                                    <Button fullWidth size="large">Process Payouts</Button>
                                    <Button fullWidth variant="plain">Global Settings</Button>
                                </BlockStack>
                            </Card>
                        </Layout.Section>
                    </Layout>
                </BlockStack>
            </Page>
        </div>
    );
}
