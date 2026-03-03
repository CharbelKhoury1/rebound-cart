import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
    Page,
    Layout,
    Text,
    Card,
    ResourceList,
    Avatar,
    ResourceItem,
    Badge,
    InlineStack,
    BlockStack,
    Box,
    Button,
    Grid,
    Divider, // Added Divider import
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await authenticate.admin(request);

    // Fetch all active representatives
    const reps = await db.platformUser.findMany({
        where: { role: "SALES_REP", status: "ACTIVE" },
        orderBy: { experience: "desc" },
    });

    // Calculate some fun marketplace stats
    const repCount = reps.length;
    const avgExperience = reps.length > 0
        ? reps.reduce((acc, rep) => acc + (Number(rep.experience) || 0), 0) / reps.length
        : 0;

    // Global platform stats
    const globalStats = {
        totalRecovered: 124500, // Mocked global stats
        recoveryRate: 24.5,
        activeStores: 120,
    };

    return json({ reps, stats: { repCount, avgExperience: avgExperience.toFixed(1), ...globalStats } });
};

export default function MarketplacePage() {
    const { reps, stats } = useLoaderData<typeof loader>();

    return (
        <Page fullWidth>
            <TitleBar title="Representative Marketplace" />

            <BlockStack gap="500">
                {/* Marketplace Hero */}
                <Box
                    padding="600"
                    background="bg-surface-brand"
                    borderRadius="300"
                >
                    <Grid>
                        <Grid.Cell columnSpan={{ xs: 6, md: 4 }}>
                            <BlockStack gap="400">
                                <Text as="h1" variant="heading2xl">Connect with Top Sales Talent</Text>
                                <Text as="p" variant="bodyLg">
                                    Our network of {stats.repCount} certified representatives is ready to turn your abandoned carts into recovered revenue.
                                    Every rep in the Rebound network undergoes rigorous performance monitoring.
                                </Text>
                                <InlineStack gap="400">
                                    <Badge tone="success">Verified Experts</Badge>
                                    <Badge tone="info">Real-time Attribution</Badge>
                                    <Badge tone="magic">24/7 Monitoring</Badge>
                                </InlineStack>
                            </BlockStack>
                        </Grid.Cell>
                        <Grid.Cell columnSpan={{ xs: 6, md: 2 }}>
                            <Card>
                                <BlockStack gap="400" align="center">
                                    <BlockStack gap="100" align="center">
                                        <Text as="h2" variant="heading3xl" alignment="center">${(stats.totalRecovered / 1000).toFixed(1)}k</Text>
                                        <Text as="p" tone="subdued" alignment="center">Global Recovered Revenue</Text>
                                    </BlockStack>
                                    <Divider />
                                    <InlineStack align="space-between">
                                        <Text as="span" tone="subdued">Network Quality</Text>
                                        <Text as="span" fontWeight="bold" tone="success">{stats.recoveryRate}% Avg Rate</Text>
                                    </InlineStack>
                                </BlockStack>
                            </Card>
                        </Grid.Cell>
                    </Grid>
                </Box>

                <Layout>
                    <Layout.Section>
                        <Card padding="0">
                            <Box padding="400" borderBlockEndWidth="025" borderColor="border">
                                <Text as="h2" variant="headingMd">Available Specialists</Text>
                            </Box>
                            <ResourceList
                                resourceName={{ singular: 'representative', plural: 'representatives' }}
                                items={reps}
                                renderItem={(item) => {
                                    const { id, firstName, lastName, tier, experience, language, skills } = item as any;
                                    const initials = `${firstName?.charAt(0)}${lastName?.charAt(0)}`;
                                    const skillList = skills ? skills.split(",") : ["Sales", "Customer Success"];

                                    return (
                                        <ResourceItem
                                            id={id}
                                            url={`#`}
                                            media={
                                                <Avatar customer size="md" name={firstName || ""} initials={initials} />
                                            }
                                            accessibilityLabel={`View details for ${firstName}`}
                                        >
                                            <InlineStack align="space-between" blockAlign="center">
                                                <BlockStack gap="100">
                                                    <InlineStack gap="200" blockAlign="center">
                                                        <Text variant="bodyMd" fontWeight="bold" as="span">
                                                            {firstName} {lastName}
                                                        </Text>
                                                        <Badge tone={tier === "PLATINUM" ? "magic" : tier === "GOLD" ? "info" : "attention"}>
                                                            {tier}
                                                        </Badge>
                                                    </InlineStack>
                                                    <InlineStack gap="200" wrap>
                                                        {skillList.slice(0, 3).map((skill: string) => (
                                                            <Badge key={skill} size="small">{skill.trim()}</Badge>
                                                        ))}
                                                        <Text as="span" tone="subdued">| {experience}y Experience</Text>
                                                    </InlineStack>
                                                </BlockStack>
                                                <InlineStack gap="300">
                                                    <BlockStack gap="0" align="end">
                                                        <Text as="span" variant="bodySm" tone="subdued">Fluent in</Text>
                                                        <Text as="span" fontWeight="bold">{language || "English"}</Text>
                                                    </BlockStack>
                                                    <Button variant="primary">Claim Expert</Button>
                                                </InlineStack>
                                            </InlineStack>
                                        </ResourceItem>
                                    );
                                }}
                            />
                        </Card>
                    </Layout.Section>

                    <Layout.Section variant="oneThird">
                        <BlockStack gap="400">
                            <Card>
                                <BlockStack gap="400">
                                    <Text as="h2" variant="headingMd">Why Use Reps?</Text>
                                    <BlockStack gap="300">
                                        <InlineStack gap="200">
                                            <div style={{ fontSize: "20px" }}>🎯</div>
                                            <Text as="p" variant="bodySm"><strong>Human Touch:</strong> Reps handle objections that emails can't.</Text>
                                        </InlineStack>
                                        <InlineStack gap="200">
                                            <div style={{ fontSize: "20px" }}>🚀</div>
                                            <Text as="p" variant="bodySm"><strong>High ROI:</strong> Only pay when they successfully recover a sale.</Text>
                                        </InlineStack>
                                        <InlineStack gap="200">
                                            <div style={{ fontSize: "20px" }}>🛡️</div>
                                            <Text as="p" variant="bodySm"><strong>Zero Risk:</strong> If they don't recover, you don't pay.</Text>
                                        </InlineStack>
                                    </BlockStack>
                                </BlockStack>
                            </Card>

                            <Box padding="500" background="bg-surface-info" borderRadius="300">
                                <BlockStack gap="200">
                                    <Text as="h3" variant="headingSm">Network Tip</Text>
                                    <Text as="p" variant="bodySm" tone="subdued">
                                        Reps with "Bilingual" skills see a 20% higher recovery rate for international stores.
                                    </Text>
                                </BlockStack>
                            </Box>
                        </BlockStack>
                    </Layout.Section>
                </Layout>
            </BlockStack>
        </Page>
    );
}
