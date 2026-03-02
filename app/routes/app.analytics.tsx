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
    ProgressBar,
    Divider,
    Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/* ============================================================
   LOADER — aggregate all analytics data
   ============================================================ */
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    // ── Checkout stats ──────────────────────────────────────────
    const totalAbandoned = await db.abandonedCheckout.count({ where: { shop } });
    const totalRecovered = await db.abandonedCheckout.count({ where: { shop, status: "RECOVERED" } });
    const totalUnclaimed = await db.abandonedCheckout.count({ where: { shop, claimedById: null } });
    const totalClaimed = await db.abandonedCheckout.count({ where: { shop, claimedById: { not: null } } });
    const recoveryRate = totalAbandoned > 0 ? (totalRecovered / totalAbandoned) * 100 : 0;
    const claimRate = totalAbandoned > 0 ? (totalClaimed / totalAbandoned) * 100 : 0;

    // ── Revenue stats ────────────────────────────────────────────
    const allCommissions = await db.commission.findMany({
        where: { checkout: { shop } },
        select: { commissionAmount: true, totalAmount: true, platformFee: true, status: true },
    });

    const totalRevenue = allCommissions.reduce((s, c) => s + Number(c.totalAmount), 0);
    const totalCommissions = allCommissions.reduce((s, c) => s + Number(c.commissionAmount), 0);
    const totalPlatformFees = allCommissions.reduce((s, c) => s + Number(c.platformFee ?? 0), 0);
    const avgOrderValue = allCommissions.length > 0 ? totalRevenue / allCommissions.length : 0;

    // ── Top performers ───────────────────────────────────────────
    const topPerformers = await db.platformUser.findMany({
        where: { status: "ACTIVE" },
        include: {
            claimedCheckouts: {
                where: { shop, status: "RECOVERED" },
                select: { id: true },
            },
            commissions: {
                where: { checkout: { shop } },
                select: { commissionAmount: true, status: true },
            },
        },
    });

    const performers = topPerformers
        .map((rep) => ({
            id: rep.id,
            name: `${rep.firstName || ""} ${rep.lastName || ""}`.trim() || rep.email,
            email: rep.email,
            tier: rep.tier,
            recoveries: rep.claimedCheckouts.length,
            totalEarned: rep.commissions.reduce((s, c) => s + Number(c.commissionAmount), 0),
            pendingPayout: rep.commissions
                .filter((c) => c.status === "PENDING")
                .reduce((s, c) => s + Number(c.commissionAmount), 0),
        }))
        .filter((p) => p.recoveries > 0 || p.totalEarned > 0)
        .sort((a, b) => b.recoveries - a.recoveries)
        .slice(0, 10);

    // ── Claimed checkouts by rep (all, not just recovered) ──────
    const allClaimedCheckouts = await db.abandonedCheckout.findMany({
        where: { shop, claimedById: { not: null } },
        include: {
            claimedBy: { select: { id: true, firstName: true, lastName: true, tier: true } },
        },
    });

    // Rep effectiveness: claimed → recovered
    const repEffectiveness: Record<string, { name: string; tier: string | null; claimed: number; recovered: number }> = {};
    for (const co of allClaimedCheckouts) {
        const rid = co.claimedById!;
        if (!repEffectiveness[rid]) {
            repEffectiveness[rid] = {
                name: `${co.claimedBy!.firstName || ""} ${co.claimedBy!.lastName || ""}`.trim(),
                tier: co.claimedBy!.tier,
                claimed: 0,
                recovered: 0,
            };
        }
        repEffectiveness[rid].claimed += 1;
        if (co.status === "RECOVERED") repEffectiveness[rid].recovered += 1;
    }

    const effectivenessRows = Object.values(repEffectiveness)
        .map((r) => ({
            ...r,
            rate: r.claimed > 0 ? (r.recovered / r.claimed) * 100 : 0,
        }))
        .sort((a, b) => b.rate - a.rate);

    // ── Monthly breakdown (last 6 months) ────────────────────────
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const recentCheckouts = await db.abandonedCheckout.findMany({
        where: { shop, createdAt: { gte: sixMonthsAgo } },
        select: { createdAt: true, status: true },
    });

    const monthlyData: Record<string, { abandoned: number; recovered: number }> = {};
    for (const co of recentCheckouts) {
        const key = new Date(co.createdAt).toLocaleString("default", {
            month: "short",
            year: "2-digit",
        });
        if (!monthlyData[key]) monthlyData[key] = { abandoned: 0, recovered: 0 };
        monthlyData[key].abandoned += 1;
        if (co.status === "RECOVERED") monthlyData[key].recovered += 1;
    }

    const monthlyBreakdown = Object.entries(monthlyData)
        .sort(([a], [b]) => new Date("01 " + a).getTime() - new Date("01 " + b).getTime())
        .map(([month, data]) => ({
            month,
            abandoned: data.abandoned,
            recovered: data.recovered,
            rate: data.abandoned > 0 ? (data.recovered / data.abandoned) * 100 : 0,
        }));

    // ── Platform health ───────────────────────────────────────────
    const totalActiveReps = await db.platformUser.count({ where: { status: "ACTIVE", role: "SALES_REP" } });
    const totalPendingReps = await db.platformUser.count({ where: { status: "PENDING" } });
    const unclaimedAbandoned = totalUnclaimed;

    return json({
        checkoutStats: {
            totalAbandoned,
            totalRecovered,
            totalUnclaimed,
            totalClaimed,
            recoveryRate,
            claimRate,
        },
        revenueStats: {
            totalRevenue,
            totalCommissions,
            totalPlatformFees,
            avgOrderValue,
            commissionCount: allCommissions.length,
        },
        performers,
        effectivenessRows,
        monthlyBreakdown,
        platformHealth: {
            totalActiveReps,
            totalPendingReps,
            unclaimedAbandoned,
            avgRecoveryRate: recoveryRate,
        },
    });
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

function fmt(n: number) {
    return `$${n.toFixed(2)}`;
}

function pct(n: number) {
    return `${n.toFixed(1)}%`;
}

/* ============================================================
   COMPONENT
   ============================================================ */
export default function AnalyticsPage() {
    const { checkoutStats, revenueStats, performers, effectivenessRows, monthlyBreakdown, platformHealth } =
        useLoaderData<typeof loader>();

    /* ── Health alerts ── */
    const hasAlerts =
        platformHealth.unclaimedAbandoned > 10 ||
        platformHealth.avgRecoveryRate < 15 ||
        platformHealth.totalPendingReps > 0;

    /* ── Top performer rows ── */
    const performerRows = performers.map((p, i) => [
        `#${i + 1}`,
        p.name,
        <Badge tone={TIER_TONE[p.tier ?? "BRONZE"] ?? "new"}>{p.tier ?? "BRONZE"}</Badge>,
        p.recoveries.toString(),
        fmt(p.totalEarned),
        <Badge tone={p.pendingPayout > 0 ? "warning" : "success"}>
            {fmt(p.pendingPayout)}
        </Badge>,
    ]);

    /* ── Effectiveness rows ── */
    const effectRows = effectivenessRows.map((r) => [
        r.name,
        <Badge tone={TIER_TONE[r.tier ?? "BRONZE"] ?? "new"}>{r.tier ?? "BRONZE"}</Badge>,
        r.claimed.toString(),
        r.recovered.toString(),
        <div style={{ minWidth: "140px" }}>
            <InlineStack gap="200" blockAlign="center">
                <div style={{ flex: 1 }}>
                    <ProgressBar
                        progress={Math.min(r.rate, 100)}
                        tone={r.rate >= 20 ? "success" : r.rate >= 10 ? "highlight" : "critical"}
                        size="small"
                    />
                </div>
                <Text as="p" variant="bodySm" fontWeight={r.rate < 15 ? "bold" : "regular"}
                    tone={r.rate >= 20 ? "success" : r.rate < 15 ? "critical" : "base"}>
                    {pct(r.rate)}
                </Text>
            </InlineStack>
        </div>,
        r.rate < 15 ? (
            <Badge tone="critical">Below Target</Badge>
        ) : r.rate >= 20 ? (
            <Badge tone="success">On Target</Badge>
        ) : (
            <Badge tone="warning">Improving</Badge>
        ),
    ]);

    /* ── Monthly breakdown rows ── */
    const monthRows = monthlyBreakdown.map((m) => [
        m.month,
        m.abandoned.toString(),
        m.recovered.toString(),
        <div style={{ minWidth: "140px" }}>
            <InlineStack gap="200" blockAlign="center">
                <div style={{ flex: 1 }}>
                    <ProgressBar
                        progress={Math.min(m.rate, 100)}
                        tone={m.rate >= 20 ? "success" : "highlight"}
                        size="small"
                    />
                </div>
                <Text as="p" variant="bodySm">{pct(m.rate)}</Text>
            </InlineStack>
        </div>,
    ]);

    return (
        <Page>
            <TitleBar title="Analytics & Insights" />

            <BlockStack gap="500">
                {/* ── Health Alerts ── */}
                {hasAlerts && (
                    <Layout>
                        <Layout.Section>
                            <BlockStack gap="300">
                                {platformHealth.unclaimedAbandoned > 10 && (
                                    <Banner tone="warning" title="Unclaimed Checkouts Alert">
                                        <p>
                                            <strong>{platformHealth.unclaimedAbandoned}</strong> abandoned checkouts are
                                            currently unclaimed. Assign them to active sales reps to start the recovery
                                            process.
                                        </p>
                                    </Banner>
                                )}
                                {platformHealth.avgRecoveryRate < 15 && checkoutStats.totalAbandoned > 0 && (
                                    <Banner tone="critical" title="Recovery Rate Below Target">
                                        <p>
                                            Your current recovery rate is{" "}
                                            <strong>{pct(platformHealth.avgRecoveryRate)}</strong>, below the{" "}
                                            <strong>15% minimum target</strong>. Consider reviewing rep performance and
                                            checkout assignment speed.
                                        </p>
                                    </Banner>
                                )}
                                {platformHealth.totalPendingReps > 0 && (
                                    <Banner tone="info" title="Pending Applications">
                                        <p>
                                            <strong>{platformHealth.totalPendingReps}</strong> sales rep application(s)
                                            are awaiting review. Approving more reps can improve checkout coverage.
                                        </p>
                                    </Banner>
                                )}
                            </BlockStack>
                        </Layout.Section>
                    </Layout>
                )}

                {/* ── Overview Stats ── */}
                <Layout>
                    <Layout.Section>
                        <Text as="h2" variant="headingMd">Checkout Recovery</Text>
                    </Layout.Section>
                    <Layout.Section>
                        <InlineStack gap="400" wrap>
                            {[
                                {
                                    label: "Total Abandoned",
                                    value: checkoutStats.totalAbandoned.toString(),
                                    sub: "All time",
                                    tone: "base",
                                },
                                {
                                    label: "Total Recovered",
                                    value: checkoutStats.totalRecovered.toString(),
                                    sub: pct(checkoutStats.recoveryRate) + " recovery rate",
                                    tone: "success",
                                },
                                {
                                    label: "Claimed",
                                    value: checkoutStats.totalClaimed.toString(),
                                    sub: pct(checkoutStats.claimRate) + " claim rate",
                                    tone: "base",
                                },
                                {
                                    label: "Unclaimed",
                                    value: checkoutStats.totalUnclaimed.toString(),
                                    sub: "Need assignment",
                                    tone: checkoutStats.totalUnclaimed > 10 ? "critical" : "base",
                                },
                            ].map(({ label, value, sub, tone }) => (
                                <Card key={label}>
                                    <BlockStack gap="100">
                                        <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
                                        <Text as="p" variant="headingLg" fontWeight="bold" tone={tone as any}>{value}</Text>
                                        <Text as="p" variant="bodySm" tone="subdued">{sub}</Text>
                                    </BlockStack>
                                </Card>
                            ))}
                        </InlineStack>
                    </Layout.Section>

                    {/* Recovery Rate Progress */}
                    <Layout.Section>
                        <Card>
                            <BlockStack gap="400">
                                <InlineStack align="space-between">
                                    <Text as="h3" variant="headingMd">Overall Recovery Rate</Text>
                                    <Text as="p" variant="headingLg" tone={checkoutStats.recoveryRate >= 20 ? "success" : checkoutStats.recoveryRate >= 15 ? "base" : "critical"} fontWeight="bold">
                                        {pct(checkoutStats.recoveryRate)}
                                    </Text>
                                </InlineStack>
                                <ProgressBar
                                    progress={Math.min(checkoutStats.recoveryRate, 100)}
                                    tone={checkoutStats.recoveryRate >= 20 ? "success" : checkoutStats.recoveryRate >= 15 ? "highlight" : "critical"}
                                    size="large"
                                />
                                <InlineStack gap="400">
                                    <Text as="p" variant="bodySm" tone="subdued">Target: 20%</Text>
                                    <Text as="p" variant="bodySm" tone="subdued">Minimum: 15%</Text>
                                    <Text as="p" variant="bodySm" tone={checkoutStats.recoveryRate >= 15 ? "success" : "critical"}>
                                        {checkoutStats.recoveryRate >= 20
                                            ? "✓ On target"
                                            : checkoutStats.recoveryRate >= 15
                                                ? "⚠ Above minimum"
                                                : "✗ Below minimum"}
                                    </Text>
                                </InlineStack>
                            </BlockStack>
                        </Card>
                    </Layout.Section>
                </Layout>

                <Divider />

                {/* ── Revenue Stats ── */}
                <Layout>
                    <Layout.Section>
                        <Text as="h2" variant="headingMd">Revenue & Commissions</Text>
                    </Layout.Section>
                    <Layout.Section>
                        <InlineStack gap="400" wrap>
                            {[
                                {
                                    label: "Total Revenue Recovered",
                                    value: fmt(revenueStats.totalRevenue),
                                    sub: `${revenueStats.commissionCount} orders`,
                                    tone: "success",
                                },
                                {
                                    label: "Commissions Paid Out",
                                    value: fmt(revenueStats.totalCommissions),
                                    sub: "To sales reps",
                                    tone: "base",
                                },
                                {
                                    label: "Platform Fee Revenue",
                                    value: fmt(revenueStats.totalPlatformFees),
                                    sub: "ReboundCart's cut",
                                    tone: "magic",
                                },
                                {
                                    label: "Avg. Recovered Order",
                                    value: fmt(revenueStats.avgOrderValue),
                                    sub: "Per recovered checkout",
                                    tone: "base",
                                },
                            ].map(({ label, value, sub, tone }) => (
                                <Card key={label}>
                                    <BlockStack gap="100">
                                        <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
                                        <Text as="p" variant="headingLg" fontWeight="bold" tone={tone as any}>{value}</Text>
                                        <Text as="p" variant="bodySm" tone="subdued">{sub}</Text>
                                    </BlockStack>
                                </Card>
                            ))}
                        </InlineStack>
                    </Layout.Section>
                </Layout>

                <Divider />

                {/* ── Top Performers ── */}
                <Layout>
                    <Layout.Section>
                        <Card>
                            <BlockStack gap="400">
                                <BlockStack gap="100">
                                    <Text as="h2" variant="headingMd">🏆 Top Performers</Text>
                                    <Text as="p" variant="bodySm" tone="subdued">
                                        Ranked by number of successful checkout recoveries
                                    </Text>
                                </BlockStack>
                                {performers.length === 0 ? (
                                    <Text as="p" variant="bodyMd" tone="subdued">
                                        No recoveries yet. Assign checkouts to active sales reps to see performance data.
                                    </Text>
                                ) : (
                                    <DataTable
                                        columnContentTypes={["text", "text", "text", "numeric", "numeric", "text"]}
                                        headings={["Rank", "Name", "Tier", "Recoveries", "Total Earned", "Pending Payout"]}
                                        rows={performerRows}
                                        hoverable
                                    />
                                )}
                            </BlockStack>
                        </Card>
                    </Layout.Section>
                </Layout>

                {/* ── Rep Effectiveness ── */}
                <Layout>
                    <Layout.Section>
                        <Card>
                            <BlockStack gap="400">
                                <BlockStack gap="100">
                                    <Text as="h2" variant="headingMd">Rep Effectiveness</Text>
                                    <Text as="p" variant="bodySm" tone="subdued">
                                        Conversion rate of claimed checkouts → recovered orders per rep. Target: 20%+, Minimum: 15%
                                    </Text>
                                </BlockStack>
                                {effectivenessRows.length === 0 ? (
                                    <Text as="p" variant="bodyMd" tone="subdued">
                                        No data yet. Reps need assigned checkouts to show effectiveness metrics.
                                    </Text>
                                ) : (
                                    <DataTable
                                        columnContentTypes={["text", "text", "numeric", "numeric", "text", "text"]}
                                        headings={["Rep", "Tier", "Claimed", "Recovered", "Recovery Rate", "Status"]}
                                        rows={effectRows}
                                        hoverable
                                    />
                                )}
                            </BlockStack>
                        </Card>
                    </Layout.Section>
                </Layout>

                {/* ── Monthly Breakdown ── */}
                {monthlyBreakdown.length > 0 && (
                    <Layout>
                        <Layout.Section>
                            <Card>
                                <BlockStack gap="400">
                                    <BlockStack gap="100">
                                        <Text as="h2" variant="headingMd">Monthly Breakdown (Last 6 Months)</Text>
                                        <Text as="p" variant="bodySm" tone="subdued">
                                            Abandoned vs recovered checkouts by month
                                        </Text>
                                    </BlockStack>
                                    <DataTable
                                        columnContentTypes={["text", "numeric", "numeric", "text"]}
                                        headings={["Month", "Abandoned", "Recovered", "Recovery Rate"]}
                                        rows={monthRows}
                                        hoverable
                                    />
                                </BlockStack>
                            </Card>
                        </Layout.Section>
                    </Layout>
                )}

                {/* ── Platform Health Summary ── */}
                <Layout>
                    <Layout.Section variant="oneThird">
                        <Card>
                            <BlockStack gap="400">
                                <Text as="h3" variant="headingMd">Platform Health</Text>
                                <BlockStack gap="300">
                                    {[
                                        {
                                            label: "Active Sales Reps",
                                            value: platformHealth.totalActiveReps.toString(),
                                            ok: platformHealth.totalActiveReps >= 5,
                                            okMsg: "Good coverage",
                                            warnMsg: "Need more reps",
                                        },
                                        {
                                            label: "Pending Applications",
                                            value: platformHealth.totalPendingReps.toString(),
                                            ok: platformHealth.totalPendingReps === 0,
                                            okMsg: "All reviewed",
                                            warnMsg: "Needs review",
                                        },
                                        {
                                            label: "Unclaimed Checkouts",
                                            value: platformHealth.unclaimedAbandoned.toString(),
                                            ok: platformHealth.unclaimedAbandoned <= 5,
                                            okMsg: "Under control",
                                            warnMsg: "Assign to reps",
                                        },
                                        {
                                            label: "Recovery Rate",
                                            value: pct(platformHealth.avgRecoveryRate),
                                            ok: platformHealth.avgRecoveryRate >= 15,
                                            okMsg: "Above minimum",
                                            warnMsg: "Below 15% target",
                                        },
                                    ].map(({ label, value, ok, okMsg, warnMsg }) => (
                                        <div key={label} style={{ padding: "8px 0", borderBottom: "1px solid var(--p-color-border)" }}>
                                            <InlineStack align="space-between">
                                                <BlockStack gap="100">
                                                    <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
                                                    <Text as="p" variant="bodyMd" fontWeight="bold">{value}</Text>
                                                </BlockStack>
                                                <Badge tone={ok ? "success" : "warning"}>
                                                    {ok ? okMsg : warnMsg}
                                                </Badge>
                                            </InlineStack>
                                        </div>
                                    ))}
                                </BlockStack>
                            </BlockStack>
                        </Card>
                    </Layout.Section>
                </Layout>
            </BlockStack>
        </Page>
    );
}
