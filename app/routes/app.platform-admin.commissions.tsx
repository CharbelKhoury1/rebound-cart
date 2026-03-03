import {
    json,
    type ActionFunctionArgs,
    type LoaderFunctionArgs,
} from "@remix-run/node";
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
    Modal,
    Banner,
    EmptyState,
    Select,
    Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { requirePlatformAdmin } from "../services/roles.server";
import db from "../db.server";
import { useState } from "react";

/* ============================================================
   LOADER — load all commissions with rep and checkout data
   ============================================================ */
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    requirePlatformAdmin(session as any);

    const commissions = await db.commission.findMany({
        orderBy: { createdAt: "desc" },
        include: {
            rep: { select: { id: true, firstName: true, lastName: true, email: true, tier: true } },
            checkout: { select: { id: true, shop: true, email: true, totalPrice: true, currency: true } },
        },
    });

    // Aggregate stats
    const totalCommissions = commissions.reduce(
        (sum, c) => sum + Number(c.commissionAmount),
        0
    );
    const pendingCommissions = commissions
        .filter((c) => c.status === "PENDING")
        .reduce((sum, c) => sum + Number(c.commissionAmount), 0);
    const paidCommissions = commissions
        .filter((c) => c.status === "PAID")
        .reduce((sum, c) => sum + Number(c.commissionAmount), 0);
    const totalPlatformFees = commissions.reduce(
        (sum, c) => sum + Number(c.platformFee ?? 0),
        0
    );

    // Per-rep summary
    const repSummary: Record<
        string,
        {
            id: string;
            name: string;
            email: string;
            tier: string | null;
            total: number;
            pending: number;
            paid: number;
            count: number;
        }
    > = {};

    for (const c of commissions) {
        const repId = c.repId;
        if (!repSummary[repId]) {
            repSummary[repId] = {
                id: repId,
                name: `${c.rep.firstName || ""} ${c.rep.lastName || ""}`.trim() || c.rep.email,
                email: c.rep.email,
                tier: c.rep.tier,
                total: 0,
                pending: 0,
                paid: 0,
                count: 0,
            };
        }
        repSummary[repId].total += Number(c.commissionAmount);
        repSummary[repId].count += 1;
        if (c.status === "PENDING") repSummary[repId].pending += Number(c.commissionAmount);
        if (c.status === "PAID") repSummary[repId].paid += Number(c.commissionAmount);
    }

    return json({
        commissions,
        stats: {
            totalCommissions,
            pendingCommissions,
            paidCommissions,
            totalPlatformFees,
            totalCount: commissions.length,
            pendingCount: commissions.filter((c) => c.status === "PENDING").length,
        },
        repSummary: Object.values(repSummary).sort((a, b) => b.total - a.total),
    });
};

/* ============================================================
   ACTION — mark commissions as paid / bulk payout
   ============================================================ */
export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    requirePlatformAdmin(session as any);

    const formData = await request.formData();
    const intent = formData.get("intent") as string;

    if (intent === "markPaid") {
        const commissionId = formData.get("commissionId") as string;
        try {
            await db.commission.update({
                where: { id: commissionId },
                data: { status: "PAID" },
            });
            return json({ success: true, message: "Commission marked as paid" });
        } catch {
            return json({ success: false, error: "Failed to update commission" }, { status: 500 });
        }
    }

    if (intent === "payAllForRep") {
        const repId = formData.get("repId") as string;
        try {
            const result = await db.commission.updateMany({
                where: { repId, status: "PENDING" },
                data: { status: "PAID" },
            });
            return json({
                success: true,
                message: `${result.count} commission(s) marked as paid for this rep`,
            });
        } catch {
            return json({ success: false, error: "Failed to process payouts" }, { status: 500 });
        }
    }

    if (intent === "payAll") {
        try {
            const result = await db.commission.updateMany({
                where: { status: "PENDING" },
                data: { status: "PAID" },
            });
            return json({
                success: true,
                message: `${result.count} pending commission(s) marked as paid`,
            });
        } catch {
            return json({ success: false, error: "Failed to process bulk payout" }, { status: 500 });
        }
    }

    return json({ success: false, error: "Invalid action" }, { status: 400 });
};

/* ============================================================
   HELPERS
   ============================================================ */
const TIER_TONE: Record<string, "magic" | "warning" | "attention" | "new"> = {
    PLATINUM: "magic",
    GOLD: "warning",
    SILVER: "attention",
    BRONZE: "new",
};

function formatCurrency(amount: number, currency = "USD") {
    return `$${amount.toFixed(2)}`;
}

/* ============================================================
   COMPONENT
   ============================================================ */
export default function CommissionsPage() {
    const { commissions, stats, repSummary } = useLoaderData<typeof loader>();
    const fetcher = useFetcher();
    const [payAllModal, setPayAllModal] = useState(false);
    const [selectedRepPayout, setSelectedRepPayout] = useState<{
        id: string;
        name: string;
        pending: number;
    } | null>(null);
    const [filterStatus, setFilterStatus] = useState("ALL");

    const isSubmitting = fetcher.state === "submitting";
    const fd = fetcher.data as any;

    const filteredCommissions =
        filterStatus === "ALL"
            ? commissions
            : commissions.filter((c) => c.status === filterStatus);

    /* ---------- Commission rows ---------- */
    const commissionRows = filteredCommissions.map((c) => {
        const repName =
            `${c.rep.firstName || ""} ${c.rep.lastName || ""}`.trim() || c.rep.email;
        return [
            c.orderNumber || c.orderId.slice(-8),
            repName,
            <Badge tone={TIER_TONE[c.rep.tier ?? "BRONZE"] ?? "new"}>
                {c.rep.tier ?? "BRONZE"}
            </Badge>,
            formatCurrency(Number(c.totalAmount)),
            formatCurrency(Number(c.commissionAmount)),
            formatCurrency(Number(c.platformFee ?? 0)),
            <Badge tone={c.status === "PAID" ? "success" : "warning"}>
                {c.status}
            </Badge>,
            new Date(c.createdAt).toLocaleDateString(),
            c.status === "PENDING" ? (
                <Button
                    size="slim"
                    variant="primary"
                    loading={isSubmitting}
                    onClick={() =>
                        fetcher.submit(
                            { intent: "markPaid", commissionId: c.id },
                            { method: "POST" }
                        )
                    }
                >
                    Mark Paid
                </Button>
            ) : (
                <Badge tone="success">Paid ✓</Badge>
            ),
        ];
    });

    /* ---------- Rep payout summary rows ---------- */
    const repRows = repSummary.map((rep) => [
        rep.name,
        rep.email,
        <Badge tone={TIER_TONE[rep.tier ?? "BRONZE"] ?? "new"}>
            {rep.tier ?? "BRONZE"}
        </Badge>,
        rep.count.toString(),
        formatCurrency(rep.total),
        formatCurrency(rep.paid),
        <Badge tone={rep.pending > 0 ? "warning" : "success"}>
            {formatCurrency(rep.pending)}
        </Badge>,
        rep.pending > 0 ? (
            <Button
                size="slim"
                variant="primary"
                onClick={() =>
                    setSelectedRepPayout({ id: rep.id, name: rep.name, pending: rep.pending })
                }
            >
                Pay All
            </Button>
        ) : (
            <Text as="p" variant="bodySm" tone="success">All paid</Text>
        ),
    ]);

    return (
        <Page>
            <TitleBar title="Commission Management" />

            <BlockStack gap="500">
                {/* Feedback */}
                {fd?.success === true && (
                    <Banner tone="success" onDismiss={() => { }}>
                        <p>{fd.message}</p>
                    </Banner>
                )}
                {fd?.success === false && (
                    <Banner tone="critical" onDismiss={() => { }}>
                        <p>{fd.error}</p>
                    </Banner>
                )}

                {/* Stats Cards */}
                <Layout>
                    <Layout.Section>
                        <InlineStack gap="400" wrap>
                            {[
                                {
                                    label: "Total Earned",
                                    value: formatCurrency(stats.totalCommissions),
                                    sub: `${stats.totalCount} commissions`,
                                    tone: "base",
                                },
                                {
                                    label: "Pending Payout",
                                    value: formatCurrency(stats.pendingCommissions),
                                    sub: `${stats.pendingCount} awaiting payment`,
                                    tone: "warning",
                                },
                                {
                                    label: "Total Paid Out",
                                    value: formatCurrency(stats.paidCommissions),
                                    sub: "Processed",
                                    tone: "success",
                                },
                                {
                                    label: "Platform Fees",
                                    value: formatCurrency(stats.totalPlatformFees),
                                    sub: "Revenue retained",
                                    tone: "magic",
                                },
                            ].map(({ label, value, sub, tone }) => (
                                <Card key={label}>
                                    <BlockStack gap="100">
                                        <Text as="p" variant="bodySm" tone="subdued">
                                            {label}
                                        </Text>
                                        <Text as="p" variant="headingLg" fontWeight="bold" tone={tone as any}>
                                            {value}
                                        </Text>
                                        <Text as="p" variant="bodySm" tone="subdued">
                                            {sub}
                                        </Text>
                                    </BlockStack>
                                </Card>
                            ))}
                        </InlineStack>
                    </Layout.Section>
                </Layout>

                {/* Per-Rep Payout Summary */}
                <Layout>
                    <Layout.Section>
                        <Card>
                            <BlockStack gap="400">
                                <InlineStack align="space-between">
                                    <BlockStack gap="100">
                                        <Text as="h2" variant="headingMd">
                                            Rep Payout Summary
                                        </Text>
                                        <Text as="p" variant="bodySm" tone="subdued">
                                            Overview of earnings and pending payouts per sales representative
                                        </Text>
                                    </BlockStack>
                                    {stats.pendingCount > 0 && (
                                        <Button
                                            variant="primary"
                                            tone="success"
                                            onClick={() => setPayAllModal(true)}
                                        >
                                            {`Pay All Pending (${stats.pendingCount})`}
                                        </Button>
                                    )}
                                </InlineStack>

                                {repSummary.length === 0 ? (
                                    <EmptyState heading="No commissions yet" image="">
                                        <p>
                                            Commissions are created automatically when a sales rep recovers an
                                            abandoned checkout. Assign reps to checkouts and wait for orders.
                                        </p>
                                    </EmptyState>
                                ) : (
                                    <DataTable
                                        columnContentTypes={[
                                            "text", "text", "text", "numeric",
                                            "numeric", "numeric", "text", "text",
                                        ]}
                                        headings={[
                                            "Rep Name", "Email", "Tier", "Recoveries",
                                            "Total Earned", "Paid Out", "Pending", "Action",
                                        ]}
                                        rows={repRows}
                                        hoverable
                                    />
                                )}
                            </BlockStack>
                        </Card>
                    </Layout.Section>
                </Layout>

                {/* All Commissions Detail */}
                <Layout>
                    <Layout.Section>
                        <Card>
                            <BlockStack gap="400">
                                <InlineStack align="space-between">
                                    <Text as="h2" variant="headingMd">
                                        Commission Log
                                    </Text>
                                    <InlineStack gap="300">
                                        <Select
                                            label=""
                                            labelHidden
                                            options={[
                                                { label: "All Commissions", value: "ALL" },
                                                { label: "Pending Only", value: "PENDING" },
                                                { label: "Paid Only", value: "PAID" },
                                            ]}
                                            value={filterStatus}
                                            onChange={setFilterStatus}
                                        />
                                        <Button
                                            variant="plain"
                                            onClick={() => {
                                                // CSV Export
                                                const headers = [
                                                    "Order ID", "Rep Name", "Tier", "Order Amount",
                                                    "Commission", "Platform Fee", "Status", "Date",
                                                ];
                                                const rows = commissions.map((c) => [
                                                    c.orderNumber || c.orderId,
                                                    `${c.rep.firstName || ""} ${c.rep.lastName || ""}`.trim(),
                                                    c.rep.tier || "BRONZE",
                                                    c.totalAmount.toString(),
                                                    c.commissionAmount.toString(),
                                                    (c.platformFee ?? 0).toString(),
                                                    c.status,
                                                    new Date(c.createdAt).toISOString().split("T")[0],
                                                ]);
                                                const csv = [headers, ...rows]
                                                    .map((r) => r.join(","))
                                                    .join("\n");
                                                const blob = new Blob([csv], { type: "text/csv" });
                                                const url = URL.createObjectURL(blob);
                                                const a = document.createElement("a");
                                                a.href = url;
                                                a.download = `rebound-commissions-${new Date().toISOString().split("T")[0]}.csv`;
                                                a.click();
                                                URL.revokeObjectURL(url);
                                            }}
                                        >
                                            Export CSV
                                        </Button>
                                    </InlineStack>
                                </InlineStack>

                                {filteredCommissions.length === 0 ? (
                                    <EmptyState heading="No commissions match this filter" image="">
                                        <p>Try a different filter.</p>
                                    </EmptyState>
                                ) : (
                                    <DataTable
                                        columnContentTypes={[
                                            "text", "text", "text", "numeric",
                                            "numeric", "numeric", "text", "text", "text",
                                        ]}
                                        headings={[
                                            "Order #", "Rep", "Tier", "Order Value",
                                            "Commission", "Platform Fee", "Status", "Date", "Action",
                                        ]}
                                        rows={commissionRows}
                                        hoverable
                                    />
                                )}
                            </BlockStack>
                        </Card>
                    </Layout.Section>
                </Layout>
            </BlockStack>

            {/* Pay All Modal */}
            <Modal
                open={payAllModal}
                onClose={() => setPayAllModal(false)}
                title="Pay All Pending Commissions"
                primaryAction={{
                    content: isSubmitting ? "Processing…" : `Pay All (${formatCurrency(stats.pendingCommissions)})`,
                    onAction: () => {
                        fetcher.submit({ intent: "payAll" }, { method: "POST" });
                        setPayAllModal(false);
                    },
                    disabled: isSubmitting,
                }}
                secondaryActions={[
                    { content: "Cancel", onAction: () => setPayAllModal(false) },
                ]}
            >
                <Modal.Section>
                    <BlockStack gap="400">
                        <Text as="p" variant="bodyMd">
                            This will mark <strong>{stats.pendingCount} pending commissions</strong> totaling{" "}
                            <strong>{formatCurrency(stats.pendingCommissions)}</strong> as paid.
                        </Text>
                        <Banner tone="warning">
                            <p>
                                Make sure you have processed the actual payments to your sales
                                representatives before confirming.
                            </p>
                        </Banner>
                    </BlockStack>
                </Modal.Section>
            </Modal>

            {/* Pay Rep Modal */}
            {selectedRepPayout && (
                <Modal
                    open={!!selectedRepPayout}
                    onClose={() => setSelectedRepPayout(null)}
                    title={`Pay ${selectedRepPayout.name}`}
                    primaryAction={{
                        content: isSubmitting
                            ? "Processing…"
                            : `Pay ${formatCurrency(selectedRepPayout.pending)}`,
                        onAction: () => {
                            fetcher.submit(
                                { intent: "payAllForRep", repId: selectedRepPayout.id },
                                { method: "POST" }
                            );
                            setSelectedRepPayout(null);
                        },
                        disabled: isSubmitting,
                    }}
                    secondaryActions={[
                        { content: "Cancel", onAction: () => setSelectedRepPayout(null) },
                    ]}
                >
                    <Modal.Section>
                        <BlockStack gap="400">
                            <Text as="p" variant="bodyMd">
                                Mark all pending commissions for{" "}
                                <strong>{selectedRepPayout.name}</strong> as paid.
                            </Text>
                            <Text as="p" variant="headingMd" tone="success">
                                Amount: {formatCurrency(selectedRepPayout.pending)}
                            </Text>
                            <Banner tone="warning">
                                <p>Confirm that the payment has been sent outside the platform before proceeding.</p>
                            </Banner>
                        </BlockStack>
                    </Modal.Section>
                </Modal>
            )}
        </Page>
    );
}
