import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
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
    Button,
    Grid,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/* ============================================================
   LOADER — aggregate all analytics data
   ============================================================ */
/* ============================================================
   LOADER — aggregate all analytics data
   ============================================================ */
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;
    const url = new URL(request.url);
    const range = url.searchParams.get("range") || "30d";

    let dateFilter: any = {};
    const now = new Date();

    if (range === "today") {
        const today = new Date(now.setHours(0, 0, 0, 0));
        dateFilter = { gte: today };
    } else if (range === "7d") {
        const lastWeek = new Date(now.setDate(now.getDate() - 7));
        dateFilter = { gte: lastWeek };
    } else if (range === "30d") {
        const lastMonth = new Date(now.setDate(now.getDate() - 30));
        dateFilter = { gte: lastMonth };
    } else if (range === "all") {
        dateFilter = undefined;
    }

    const whereBase = { shop, ...(dateFilter ? { createdAt: dateFilter } : {}) };

    // ── Checkout stats ──────────────────────────────────────────
    const totalAbandoned = await db.abandonedCheckout.count({ where: whereBase });
    const totalRecovered = await db.abandonedCheckout.count({ where: { ...whereBase, status: "RECOVERED" } });
    const totalUnclaimed = await db.abandonedCheckout.count({ where: { ...whereBase, claimedById: null } });
    const totalClaimed = await db.abandonedCheckout.count({ where: { ...whereBase, claimedById: { not: null } } });
    const recoveryRate = totalAbandoned > 0 ? (totalRecovered / totalAbandoned) * 100 : 0;
    const claimRate = totalAbandoned > 0 ? (totalClaimed / totalAbandoned) * 100 : 0;

    // ── Revenue stats ────────────────────────────────────────────
    const allCommissions = await db.commission.findMany({
        where: { checkout: whereBase },
        select: { commissionAmount: true, totalAmount: true, platformFee: true, status: true, createdAt: true, checkout: { select: { createdAt: true } } },
    });

    const totalRevenue = allCommissions.reduce((s, c) => s + Number(c.totalAmount), 0);
    const totalCommissions = allCommissions.reduce((s, c) => s + Number(c.commissionAmount), 0);
    const totalPlatformFees = allCommissions.reduce((s, c) => s + Number(c.platformFee ?? 0), 0);
    const avgOrderValue = allCommissions.length > 0 ? totalRevenue / allCommissions.length : 0;

    // ── Recovery Velocity (Avg time to recover) ──────────────────
    let totalRecoveryTimeMs = 0;
    let recoveryCount = 0;
    allCommissions.forEach(c => {
        if (c.checkout?.createdAt) {
            const diff = new Date(c.createdAt).getTime() - new Date(c.checkout.createdAt).getTime();
            if (diff > 0) {
                totalRecoveryTimeMs += diff;
                recoveryCount++;
            }
        }
    });
    const avgRecoveryTimeHours = recoveryCount > 0 ? (totalRecoveryTimeMs / (1000 * 60 * 60 * recoveryCount)) : 0;

    // ── Peak Recovery Hours (UTC) ────────────────────────────────
    const hourCounts: Record<number, number> = {};
    allCommissions.forEach(c => {
        const hour = new Date(c.createdAt).getUTCHours();
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });
    const peakHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    // ── Top performers ───────────────────────────────────────────
    const topPerformers = await db.platformUser.findMany({
        where: { status: "ACTIVE" },
        include: {
            claimedCheckouts: {
                where: { ...whereBase, status: "RECOVERED" },
                select: { id: true },
            },
            commissions: {
                where: { checkout: whereBase },
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
        where: { ...whereBase, claimedById: { not: null } },
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

    // ── Date breakdown (labels depend on range) ─────────────────
    const dateBreakdownData = await db.abandonedCheckout.findMany({
        where: whereBase,
        select: { createdAt: true, status: true },
    });

    const breakdown: Record<string, { abandoned: number; recovered: number }> = {};
    for (const co of dateBreakdownData) {
        let key = "";
        if (range === "today") {
            key = new Date(co.createdAt).getUTCHours() + ":00";
        } else {
            key = new Date(co.createdAt).toLocaleDateString("default", { month: "short", day: "numeric" });
        }
        if (!breakdown[key]) breakdown[key] = { abandoned: 0, recovered: 0 };
        breakdown[key].abandoned += 1;
        if (co.status === "RECOVERED") breakdown[key].recovered += 1;
    }

    const breakdownRows = Object.entries(breakdown)
        .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
        .map(([label, data]) => ({
            label,
            abandoned: data.abandoned,
            recovered: data.recovered,
            rate: data.abandoned > 0 ? (data.recovered / data.abandoned) * 100 : 0,
        }));

    // ── Platform health ───────────────────────────────────────────
    const totalActiveReps = await db.platformUser.count({ where: { status: "ACTIVE", role: "SALES_REP" } });

    return json({
        range,
        checkoutStats: {
            totalAbandoned,
            totalRecovered,
            totalUnclaimed,
            totalClaimed,
            recoveryRate,
            claimRate,
            avgRecoveryTimeHours,
            peakHour,
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
        breakdownRows,
        platformHealth: {
            totalActiveReps,
            totalPendingReps: await db.platformUser.count({ where: { status: "PENDING" } }),
            unclaimedAbandoned: totalUnclaimed,
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
    const { range, checkoutStats, revenueStats, performers, effectivenessRows, breakdownRows, platformHealth } =
        useLoaderData<typeof loader>();

    const fetcher = useFetcher();

    /* ── Health alerts ── */
    const hasAlerts =
        platformHealth.unclaimedAbandoned > 10 ||
        platformHealth.avgRecoveryRate < 15;

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

    /* ── Breakdown rows ── */
    const breakdownDataTableRows = breakdownRows.map((m: any) => [
        m.label,
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

    const handleRangeChange = (value: string) => {
        const url = new URL(window.location.href);
        url.searchParams.set("range", value);
        window.history.replaceState({}, "", url.toString());
        fetcher.load(url.pathname + url.search);
    };

    return (
        <Page>
            <TitleBar title="Analytics & Insights" />

            <BlockStack gap="500">
                {/* ── Time Range Selector ── */}
                <Layout>
                    <Layout.Section>
                        <Card>
                            <InlineStack align="space-between" blockAlign="center">
                                <Text as="h2" variant="headingMd">Performance Period</Text>
                                <InlineStack gap="200">
                                    <Button
                                        variant={range === "today" ? "primary" : "secondary"}
                                        onClick={() => (window.location.href = "?range=today")}
                                    >
                                        Today
                                    </Button>
                                    <Button
                                        variant={range === "7d" ? "primary" : "secondary"}
                                        onClick={() => (window.location.href = "?range=7d")}
                                    >
                                        Last 7 Days
                                    </Button>
                                    <Button
                                        variant={range === "30d" ? "primary" : "secondary"}
                                        onClick={() => (window.location.href = "?range=30d")}
                                    >
                                        Last 30 Days
                                    </Button>
                                    <Button
                                        variant={range === "all" ? "primary" : "secondary"}
                                        onClick={() => (window.location.href = "?range=all")}
                                    >
                                        All Time
                                    </Button>
                                </InlineStack>
                            </InlineStack>
                        </Card>
                    </Layout.Section>
                </Layout>

                {/* ── Health Alerts (Store Centric) ── */}
                {hasAlerts && (
                    <Layout>
                        <Layout.Section>
                            <BlockStack gap="300">
                                {platformHealth.unclaimedAbandoned > 10 && (
                                    <Banner tone="warning" title="Items Awaiting Recovery">
                                        <p>
                                            <strong>{platformHealth.unclaimedAbandoned}</strong> checkouts are
                                            detected but not yet claimed by a representative.
                                        </p>
                                    </Banner>
                                )}
                                {platformHealth.avgRecoveryRate < 15 && checkoutStats.totalAbandoned > 0 && (
                                    <Banner tone="critical" title="Recovery Rate Opportunity">
                                        <p>
                                            Your current recovery rate is{" "}
                                            <strong>{pct(platformHealth.avgRecoveryRate)}</strong>. Improving response
                                            times can help convert more abandoned carts.
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
                        <Grid>
                            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3 }}>
                                <Card>
                                    <BlockStack gap="100">
                                        <Text as="p" variant="bodySm" tone="subdued">Total Abandoned</Text>
                                        <Text as="p" variant="headingLg" fontWeight="bold">{checkoutStats.totalAbandoned}</Text>
                                        <Text as="p" variant="bodySm" tone="subdued">{range === "all" ? "All time" : `Last ${range}`}</Text>
                                    </BlockStack>
                                </Card>
                            </Grid.Cell>
                            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3 }}>
                                <Card>
                                    <BlockStack gap="100">
                                        <Text as="p" variant="bodySm" tone="subdued">Total Recovered</Text>
                                        <Text as="p" variant="headingLg" fontWeight="bold" tone="success">{checkoutStats.totalRecovered}</Text>
                                        <Text as="p" variant="bodySm" tone="subdued">{pct(checkoutStats.recoveryRate)} rate</Text>
                                    </BlockStack>
                                </Card>
                            </Grid.Cell>
                            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3 }}>
                                <Card>
                                    <BlockStack gap="100">
                                        <Text as="p" variant="bodySm" tone="subdued">Recovery Speed</Text>
                                        <Text as="p" variant="headingLg" fontWeight="bold" tone="base">{checkoutStats.avgRecoveryTimeHours.toFixed(1)}h</Text>
                                        <Text as="p" variant="bodySm" tone="subdued">Avg. time to sale</Text>
                                    </BlockStack>
                                </Card>
                            </Grid.Cell>
                            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3 }}>
                                <Card>
                                    <BlockStack gap="100">
                                        <Text as="p" variant="bodySm" tone="subdued">Peak Recovery</Text>
                                        <Text as="p" variant="headingLg" fontWeight="bold" tone="magic">{checkoutStats.peakHour !== null ? `${checkoutStats.peakHour}:00` : "N/A"}</Text>
                                        <Text as="p" variant="bodySm" tone="subdued">Most active hour (UTC)</Text>
                                    </BlockStack>
                                </Card>
                            </Grid.Cell>
                        </Grid>
                    </Layout.Section>

                    {/* Recovery Rate Progress */}
                    <Layout.Section>
                        <Card>
                            <BlockStack gap="400">
                                <InlineStack align="space-between">
                                    <Text as="h3" variant="headingMd">Period Recovery Rate</Text>
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
                        <Text as="h2" variant="headingMd">Financial Summary</Text>
                    </Layout.Section>
                    <Layout.Section>
                        <Grid>
                            <Grid.Cell columnSpan={{ xs: 6, md: 3 }}>
                                <Card>
                                    <BlockStack gap="100">
                                        <Text as="p" variant="bodySm" tone="subdued">Revenue Recovered</Text>
                                        <Text as="p" variant="headingLg" fontWeight="bold" tone="success">{fmt(revenueStats.totalRevenue)}</Text>
                                        <Text as="p" variant="bodySm" tone="subdued">{revenueStats.commissionCount} orders</Text>
                                    </BlockStack>
                                </Card>
                            </Grid.Cell>
                            <Grid.Cell columnSpan={{ xs: 6, md: 3 }}>
                                <Card>
                                    <BlockStack gap="100">
                                        <Text as="p" variant="bodySm" tone="subdued">Net Profit (ROI)</Text>
                                        <Text as="p" variant="headingLg" fontWeight="bold" tone="success">{fmt(revenueStats.totalRevenue - revenueStats.totalCommissions - revenueStats.totalPlatformFees)}</Text>
                                        <Text as="p" variant="bodySm" tone="subdued">After all fees</Text>
                                    </BlockStack>
                                </Card>
                            </Grid.Cell>
                            <Grid.Cell columnSpan={{ xs: 6, md: 3 }}>
                                <Card>
                                    <BlockStack gap="100">
                                        <Text as="p" variant="bodySm" tone="subdued">Avg. Recovery Value</Text>
                                        <Text as="p" variant="headingLg" fontWeight="bold">{fmt(revenueStats.avgOrderValue)}</Text>
                                        <Text as="p" variant="bodySm" tone="subdued">Per conversion</Text>
                                    </BlockStack>
                                </Card>
                            </Grid.Cell>
                            <Grid.Cell columnSpan={{ xs: 6, md: 3 }}>
                                <Card>
                                    <BlockStack gap="100">
                                        <Text as="p" variant="bodySm" tone="subdued">Total Fees</Text>
                                        <Text as="p" variant="headingLg" fontWeight="bold" tone="critical">{fmt(revenueStats.totalCommissions + revenueStats.totalPlatformFees)}</Text>
                                        <Text as="p" variant="bodySm" tone="subdued">Cost of recovery</Text>
                                    </BlockStack>
                                </Card>
                            </Grid.Cell>
                        </Grid>
                    </Layout.Section>
                </Layout>

                <Divider />

                {/* ── Breakdown ── */}
                {breakdownRows.length > 0 && (
                    <Layout>
                        <Layout.Section>
                            <Card>
                                <BlockStack gap="400">
                                    <BlockStack gap="100">
                                        <Text as="h2" variant="headingMd">Recovery Timeline</Text>
                                        <Text as="p" variant="bodySm" tone="subdued">
                                            Daily breakdown of abandonment vs recovery events
                                        </Text>
                                    </BlockStack>
                                    <DataTable
                                        columnContentTypes={["text", "numeric", "numeric", "text"]}
                                        headings={["Period", "Abandoned", "Recovered", "Recovery Rate"]}
                                        rows={breakdownDataTableRows as any}
                                        hoverable
                                    />
                                </BlockStack>
                            </Card>
                        </Layout.Section>
                    </Layout>
                )}

                {/* ── Top Performers ── */}
                <Layout>
                    <Layout.Section>
                        <Card>
                            <BlockStack gap="400">
                                <BlockStack gap="100">
                                    <Text as="h2" variant="headingMd">🏆 Top Performance Specialists</Text>
                                    <Text as="p" variant="bodySm" tone="subdued">
                                        Top representatives active for your store in this period
                                    </Text>
                                </BlockStack>
                                {performers.length === 0 ? (
                                    <Text as="p" variant="bodyMd" tone="subdued">
                                        No recoveries yet for this period.
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
                                    <Text as="h2" variant="headingMd">Specialist Effectiveness</Text>
                                    <Text as="p" variant="bodySm" tone="subdued">
                                        Conversion rate of assigned checkouts → recovered orders.
                                    </Text>
                                </BlockStack>
                                {effectivenessRows.length === 0 ? (
                                    <Text as="p" variant="bodyMd" tone="subdued">
                                        No specialist activity recorded for this period.
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

            </BlockStack>
        </Page>
    );
}
