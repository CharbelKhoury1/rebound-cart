import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
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
    Badge,
    Modal,
    TextField,
    Select,
    FormLayout,
    Divider,
    Box,
    Grid,
} from "@shopify/polaris";
import db from "../db.server";
import { getSession, commitSession } from "../sessions.server";
import { useState } from "react";
import { generateAIQualityAssessment } from "../utils/ai.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const session = await getSession(request.headers.get("Cookie"));
    if (!session.has("userId") || session.get("userRole") !== "SALES_REP") {
        return redirect("/portal");
    }
    const userId = session.get("userId");

    const salesRep = await (db.platformUser as any).findUnique({
        where: { id: userId },
        include: {
            claimedCheckouts: {
                orderBy: { updatedAt: "desc" },
                include: { communications: { orderBy: { createdAt: "desc" } } },
            },
            commissions: {
                orderBy: { createdAt: "desc" },
            },
        },
    });

    if (!salesRep) return redirect("/portal");

    const enabledShops = await db.shopSettings.findMany({
        where: { isMarketplaceEnabled: true } as any,
        select: { shop: true }
    });
    const shopList = (enabledShops as any[]).map((s: any) => s.shop);

    const availableCheckouts = await (db.abandonedCheckout as any).findMany({
        where: {
            claimedById: null,
            status: "ABANDONED",
            shop: { in: shopList }
        },
        orderBy: { createdAt: "desc" },
        take: 50,
    });

    const totalCheckouts = (salesRep as any).claimedCheckouts?.length || 0;
    const recoveredCheckouts = (salesRep as any).claimedCheckouts?.filter((c: any) => c.status === "RECOVERED").length || 0;
    const totalEarnings = (salesRep as any).commissions?.reduce((sum: number, c: any) => sum + Number(c.commissionAmount), 0) || 0;
    const recoveryRate = totalCheckouts > 0 ? (recoveredCheckouts / totalCheckouts) * 100 : 0;

    return json({
        salesRep: salesRep as any,
        availableCheckouts: availableCheckouts as any[],
        stats: {
            totalCheckouts,
            recoveredCheckouts,
            recoveryRate,
            totalEarnings,
            tier: (salesRep as any).tier || "BRONZE",
        },
    });
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const session = await getSession(request.headers.get("Cookie"));
    if (!session.has("userId")) return json({ error: "Unauthorized" }, { status: 401 });
    const userId = session.get("userId");

    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "logout") {
        return redirect("/portal", {
            headers: {
                "Set-Cookie": await commitSession(session),
            },
        });
    }

    const checkoutId = formData.get("checkoutId") as string;

    if (intent === "claimCheckout") {
        await (db.abandonedCheckout as any).update({
            where: { id: checkoutId },
            data: { claimedById: userId, claimedAt: new Date() },
        });
        return json({ success: true, message: "Claimed!" });
    }

    if (intent === "logCommunication") {
        const channel = formData.get("channel") as string;
        const content = formData.get("content") as string;

        // NEW: AI-powered quality assessment
        const qc = await generateAIQualityAssessment(content);

        await (db as any).$transaction([
            (db as any).communication.create({
                data: {
                    checkoutId,
                    repId: userId,
                    channel,
                    content,
                    qcScore: qc.score,
                    qcFeedback: qc.feedback,
                    sentiment: qc.sentiment
                },
            }),
            (db.abandonedCheckout as any).update({
                where: { id: checkoutId },
                data: { lastContactedAt: new Date() },
            }),
        ]);
        return json({ success: true, message: "Logged!" });
    }

    return json({ success: false, error: "Invalid" });
};

export default function RepPortalDashboard() {
    const data = useLoaderData<typeof loader>();
    const { salesRep, stats, availableCheckouts } = data as any;
    const actionData = useActionData<typeof action>();
    const [selectedCheckout, setSelectedCheckout] = useState<any>(null);
    const [modalActive, setModalActive] = useState(false);
    const fetcher = useFetcher();
    const isSubmitting = fetcher.state === "submitting";

    const checkoutRows = salesRep?.claimedCheckouts?.map((checkout: any) => {
        const lastComm = checkout.communications?.[0];
        return [
            checkout.checkoutId.slice(-8),
            checkout.email || "N/A",
            `${Number(checkout.totalPrice).toFixed(2)} ${checkout.currency}`,
            <Badge key="status" tone={checkout.status === "RECOVERED" ? "success" : "attention"}>{checkout.status}</Badge>,
            checkout.lastContactedAt ? new Date(checkout.lastContactedAt).toLocaleDateString() : "Never",
            <Badge key="qc" tone={lastComm?.qcScore > 80 ? "success" : lastComm?.qcScore > 50 ? "attention" : "critical"}>
                {lastComm ? `${lastComm.qcScore}%` : "N/A"}
            </Badge>,
            <Button key="action" size="slim" variant="plain" onClick={() => { setSelectedCheckout(checkout); setModalActive(true); }}>Work</Button>,
        ];
    }) || [];

    const marketplaceRows = availableCheckouts?.map((checkout: any) => [
        checkout.checkoutId.slice(-8),
        checkout.email || "N/A",
        `${checkout.totalPrice} ${checkout.currency}`,
        <Badge key="tag" tone="info">NEW</Badge>,
        new Date(checkout.createdAt).toLocaleDateString(),
        <fetcher.Form key="form" method="post">
            <input type="hidden" name="intent" value="claimCheckout" />
            <input type="hidden" name="checkoutId" value={checkout.id} />
            <Button size="slim" variant="primary" submit loading={isSubmitting}>Claim</Button>
        </fetcher.Form>,
    ]) || [];

    return (
        <div style={{ minHeight: "100vh" }}>
            <Box background="bg-surface" padding="400" borderBlockEndWidth="025">
                <InlineStack align="space-between">
                    <Text as="h1" variant="headingLg">Recovery Portal</Text>
                    <fetcher.Form method="post"><input type="hidden" name="intent" value="logout" /><Button submit>Logout</Button></fetcher.Form>
                </InlineStack>
            </Box>
            <Page fullWidth>
                <BlockStack gap="500">
                    {/* Stats Section */}
                    <Layout>
                        <Layout.Section>
                            <Grid>
                                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                                    <Card>
                                        <Box padding="100">
                                            <BlockStack gap="200">
                                                <Text as="h2" variant="bodySm" tone="subdued">Total Earnings</Text>
                                                <Text as="p" variant="headingLg" fontWeight="bold" tone="magic">${stats.totalEarnings.toFixed(2)}</Text>
                                            </BlockStack>
                                        </Box>
                                    </Card>
                                </Grid.Cell>
                                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                                    <Card>
                                        <Box padding="100">
                                            <BlockStack gap="200">
                                                <Text as="h2" variant="bodySm" tone="subdued">Recovery Rate</Text>
                                                <Text as="p" variant="headingLg" fontWeight="bold" tone="success">{stats.recoveryRate.toFixed(1)}%</Text>
                                            </BlockStack>
                                        </Box>
                                    </Card>
                                </Grid.Cell>
                                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                                    <Card>
                                        <Box padding="100">
                                            <BlockStack gap="200">
                                                <Text as="h2" variant="bodySm" tone="subdued">Active Recoveries</Text>
                                                <Text as="p" variant="headingLg" fontWeight="bold">{stats.totalCheckouts}</Text>
                                            </BlockStack>
                                        </Box>
                                    </Card>
                                </Grid.Cell>
                                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                                    <Card>
                                        <Box padding="100">
                                            <BlockStack gap="200">
                                                <Text as="h2" variant="bodySm" tone="subdued">Current Tier</Text>
                                                <Badge tone="magic">{stats.tier}</Badge>
                                            </BlockStack>
                                        </Box>
                                    </Card>
                                </Grid.Cell>
                            </Grid>
                        </Layout.Section>
                    </Layout>

                    <Layout>
                        <Layout.Section>
                            <Card>
                                <Box padding="400">
                                    <BlockStack gap="400">
                                        <Text as="h2" variant="headingMd">My Active Recoveries</Text>
                                        {checkoutRows.length === 0 ? (
                                            <Text as="p" tone="subdued">You haven't claimed any checkouts yet. Browse the marketplace to get started.</Text>
                                        ) : (
                                            <DataTable
                                                columnContentTypes={["text", "text", "text", "text", "text", "text", "text"]}
                                                headings={["ID", "Customer", "Amount", "Status", "Last Contact", "AI QC", "Action"]}
                                                rows={checkoutRows}
                                            />
                                        )}
                                    </BlockStack>
                                </Box>
                            </Card>
                        </Layout.Section>

                        <Layout.Section>
                            <Card>
                                <Box padding="400">
                                    <BlockStack gap="400">
                                        <InlineStack align="space-between">
                                            <Text as="h2" variant="headingMd">Available in Marketplace</Text>
                                            <Badge tone="new">Available</Badge>
                                        </InlineStack>
                                        <DataTable
                                            columnContentTypes={["text", "text", "text", "text", "text", "text"]}
                                            headings={["ID", "Customer", "Amount", "Status", "Detected", "Action"]}
                                            rows={marketplaceRows}
                                        />
                                    </BlockStack>
                                </Box>
                            </Card>
                        </Layout.Section>
                    </Layout>
                </BlockStack>

                {selectedCheckout && (
                    <Modal open={modalActive} onClose={() => { setModalActive(false); setSelectedCheckout(null); }} title="Activity Log">
                        <Modal.Section>
                            <fetcher.Form method="post">
                                <input type="hidden" name="intent" value="logCommunication" />
                                <input type="hidden" name="checkoutId" value={selectedCheckout.id} />
                                <FormLayout>
                                    <Select label="Channel" name="channel" options={[{ label: "WhatsApp", value: "WhatsApp" }]} value="WhatsApp" onChange={() => { }} />
                                    <TextField label="Content" name="content" multiline={3} autoComplete="off" />
                                    <Button submit variant="primary" loading={isSubmitting}>Log</Button>
                                </FormLayout>
                            </fetcher.Form>
                        </Modal.Section>
                    </Modal>
                )}
            </Page>
        </div>
    );
}
