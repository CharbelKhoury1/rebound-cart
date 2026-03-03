import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
    Page,
    Layout,
    Text,
    Card,
    BlockStack,
    InlineStack,
    DataTable,
    Badge,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const commissions = await db.commission.findMany({
        where: { checkout: { shop } },
        orderBy: { createdAt: "desc" },
        include: {
            checkout: { select: { email: true, totalPrice: true, currency: true, orderId: true } },
        },
    });

    const stats = {
        totalPaid: commissions.reduce((sum, c) => sum + Number(c.commissionAmount) + Number(c.platformFee || 0), 0),
        totalRevenue: commissions.reduce((sum, c) => sum + Number(c.totalAmount), 0),
        count: commissions.length,
    };

    return json({ commissions, stats });
};

export default function PayoutsPage() {
    const { commissions, stats } = useLoaderData<typeof loader>();

    const rows = commissions.map((c) => [
        c.orderNumber || c.orderId.slice(-8),
        c.checkout.email || "N/A",
        `${Number(c.totalAmount).toFixed(2)} ${c.checkout.currency}`,
        `${Number(c.commissionAmount).toFixed(2)} ${c.checkout.currency}`,
        `${Number(c.platformFee || 0).toFixed(2)} ${c.checkout.currency}`,
        <Badge tone={c.status === "PAID" ? "success" : "attention"}>
            {c.status}
        </Badge>,
        new Date(c.createdAt).toLocaleDateString(),
    ]);

    return (
        <Page>
            <TitleBar title="My Settlements" />
            <BlockStack gap="500">
                <Layout>
                    <Layout.Section>
                        <InlineStack gap="400">
                            <Card>
                                <BlockStack gap="100">
                                    <Text as="p" variant="bodySm" tone="subdued">Total Revenue Recovered</Text>
                                    <Text as="p" variant="headingLg" fontWeight="bold" tone="success">${stats.totalRevenue.toFixed(2)}</Text>
                                    <Text as="p" variant="bodySm" tone="subdued">{stats.count} recovered orders</Text>
                                </BlockStack>
                            </Card>
                            <Card>
                                <BlockStack gap="100">
                                    <Text as="p" variant="bodySm" tone="subdued">Total Fees & Commissions</Text>
                                    <Text as="p" variant="headingLg" fontWeight="bold" tone="critical">${stats.totalPaid.toFixed(2)}</Text>
                                    <Text as="p" variant="bodySm" tone="subdued">Rep fees + Platform fees</Text>
                                </BlockStack>
                            </Card>
                        </InlineStack>
                    </Layout.Section>

                    <Layout.Section>
                        <Card>
                            <BlockStack gap="400">
                                <Text as="h2" variant="headingMd">Recovery Payout History</Text>
                                {commissions.length === 0 ? (
                                    <Text as="p" variant="bodyMd" tone="subdued">No recovered checkouts yet.</Text>
                                ) : (
                                    <DataTable
                                        columnContentTypes={["text", "text", "numeric", "numeric", "numeric", "text", "text"]}
                                        headings={["Order #", "Customer", "Order Value", "Rep Fee", "Platform Fee", "Status", "Date"]}
                                        rows={rows}
                                        hoverable
                                    />
                                )}
                            </BlockStack>
                        </Card>
                    </Layout.Section>
                </Layout>
            </BlockStack>
        </Page>
    );
}
