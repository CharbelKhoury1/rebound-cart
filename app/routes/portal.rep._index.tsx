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
} from "@shopify/polaris";
import db from "../db.server";
import { getSession, commitSession } from "../sessions.server";
import { useState } from "react";

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

        await (db as any).$transaction([
            (db as any).communication.create({
                data: { checkoutId, repId: userId, channel, content, qcScore: 85, qcFeedback: "Great!", sentiment: "Positive" },
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

    const checkoutRows = salesRep?.claimedCheckouts?.map((checkout: any) => [
        checkout.checkoutId.slice(-8),
        checkout.email || "N/A",
        `${checkout.totalPrice} ${checkout.currency}`,
        <Badge key="status" tone={checkout.status === "RECOVERED" ? "success" : "attention"}>{checkout.status}</Badge>,
        checkout.lastContactedAt ? new Date(checkout.lastContactedAt).toLocaleDateString() : "Never",
        <Badge key="qc" tone="info">85%</Badge>,
        <Button key="action" size="slim" variant="plain" onClick={() => { setSelectedCheckout(checkout); setModalActive(true); }}>Work</Button>,
    ]) || [];

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
                <Layout>
                    <Layout.Section variant="oneThird">
                        <Card><Text as="h2" variant="headingMd">My Earnings: ${stats.totalEarnings.toFixed(2)}</Text></Card>
                    </Layout.Section>
                    <Layout.Section>
                        <Card>
                            <Text as="h2" variant="headingMd">My Recoveries</Text>
                            <DataTable columnContentTypes={["text", "text", "text", "text", "text", "text", "text"]} headings={["ID", "Customer", "Amount", "Status", "Contact", "QC", "Action"]} rows={checkoutRows} />
                        </Card>
                        <Box paddingBlock="400" />
                        <Card>
                            <Text as="h2" variant="headingMd">Marketplace</Text>
                            <DataTable columnContentTypes={["text", "text", "text", "text", "text", "text"]} headings={["ID", "Customer", "Amount", "Status", "Date", "Action"]} rows={marketplaceRows} />
                        </Card>
                    </Layout.Section>
                </Layout>

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
