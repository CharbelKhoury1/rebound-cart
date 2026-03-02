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
  Badge,
  Modal,
  TextField,
  Select,
  FormLayout,
  Divider,
  Box,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const repEmail = (session as any).email;

  // Get sales rep data
  const salesRep = await db.platformUser.findUnique({
    where: { email: repEmail },
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

  if (!salesRep || salesRep.role !== "SALES_REP") {
    throw new Response("Unauthorized: Sales representative access required", { status: 403 });
  }

  // Get Marketplace checkouts (unclaimed) from stores that have enabled it
  const enabledShops = await db.shopSettings.findMany({
    where: { isMarketplaceEnabled: true },
    select: { shop: true }
  });
  const shopList = enabledShops.map(s => s.shop);

  const availableCheckouts = await db.abandonedCheckout.findMany({
    where: {
      claimedById: null,
      status: "ABANDONED",
      shop: { in: shopList }
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  // Calculate performance metrics
  const totalCheckouts = salesRep.claimedCheckouts?.length || 0;
  const recoveredCheckouts = salesRep.claimedCheckouts?.filter((c: any) => c.status === "RECOVERED").length || 0;
  const totalEarnings = salesRep.commissions?.reduce((sum: number, c: any) => sum + Number(c.commissionAmount), 0) || 0;
  const recoveryRate = totalCheckouts > 0 ? (recoveredCheckouts / totalCheckouts) * 100 : 0;

  return json({
    salesRep,
    availableCheckouts,
    stats: {
      totalCheckouts,
      recoveredCheckouts,
      recoveryRate,
      totalEarnings,
      tier: salesRep.tier || "BRONZE",
    },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const repEmail = (session as any).email;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "claimCheckout") {
    const checkoutId = formData.get("checkoutId") as string;

    try {
      const rep = await db.platformUser.findUnique({ where: { email: repEmail } });
      if (!rep) return json({ success: false, error: "Rep not found" }, { status: 404 });

      await db.abandonedCheckout.update({
        where: { id: checkoutId },
        data: {
          claimedById: rep.id,
          claimedAt: new Date(),
        },
      });
      return json({ success: true, message: "Checkout claimed successfully" });
    } catch (error) {
      return json({ success: false, error: "Failed to claim checkout" }, { status: 500 });
    }
  }

  if (intent === "unclaimCheckout") {
    const checkoutId = formData.get("checkoutId") as string;

    try {
      await db.abandonedCheckout.update({
        where: { id: checkoutId },
        data: {
          claimedById: null,
          claimedAt: null,
        },
      });
      return json({ success: true, message: "Checkout unclaimed successfully" });
    } catch (error) {
      return json({ success: false, error: "Failed to unclaim checkout" }, { status: 500 });
    }
  }

  if (intent === "logCommunication") {
    const checkoutId = formData.get("checkoutId") as string;
    const channel = formData.get("channel") as string;
    const content = formData.get("content") as string;

    const rep = await db.platformUser.findUnique({ where: { email: repEmail } });
    if (!rep) return json({ success: false, error: "Rep not found" }, { status: 404 });

    // Mock AI Assessment Logic
    const words = content.split(" ").length;
    let sentiment = "Neutral";
    let score = 70;
    let feedback = "Good initial contact. Try to create more urgency.";

    if (content.toLowerCase().includes("urgent") || content.toLowerCase().includes("limited")) {
      score += 15;
      feedback = "Excellent use of scarcity and urgency.";
    }
    if (words > 20) {
      score += 10;
      sentiment = "Positive";
    }
    if (content.length < 10) {
      score = 40;
      feedback = "Communication too short. Provide more value.";
      sentiment = "Negative";
    }

    try {
      await db.$transaction([
        db.communication.create({
          data: {
            checkoutId,
            repId: rep.id,
            channel,
            content,
            qcScore: Math.min(score, 100),
            qcFeedback: feedback,
            sentiment,
          },
        }),
        db.abandonedCheckout.update({
          where: { id: checkoutId },
          data: { lastContactedAt: new Date() },
        }),
      ]);
      return json({ success: true, message: "Communication logged and assessed by AI" });
    } catch (error) {
      return json({ success: false, error: "Failed to log communication" }, { status: 500 });
    }
  }

  return json({ success: false, error: "Invalid action" }, { status: 400 });
};

export default function RepDashboard() {
  const data = useLoaderData<typeof loader>();
  const { salesRep, stats, availableCheckouts } = data as any;
  const actionData = useActionData<typeof action>();
  const [selectedCheckout, setSelectedCheckout] = useState<any>(null);
  const [modalActive, setModalActive] = useState(false);
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state === "submitting";

  const checkoutRows = salesRep?.claimedCheckouts?.map((checkout: any) => {
    const avgScore = checkout.communications?.length > 0
      ? Math.round(checkout.communications.reduce((sum: number, c: any) => sum + (c.qcScore || 0), 0) / checkout.communications.length)
      : null;

    return [
      checkout.checkoutId.slice(-8) + "...",
      checkout.email || "N/A",
      `${checkout.totalPrice} ${checkout.currency}`,
      <Badge tone={checkout.status === "RECOVERED" ? "success" : "attention"}>
        {checkout.status}
      </Badge>,
      checkout.lastContactedAt ? new Date(checkout.lastContactedAt).toLocaleDateString() : "Never",
      avgScore !== null ? (
        <Badge tone={avgScore >= 80 ? "success" : avgScore >= 60 ? "warning" : "critical"}>
          {`${avgScore}%`}
        </Badge>
      ) : "N/A",
      <InlineStack gap="200">
        <Button size="slim" variant="plain" onClick={() => {
          setSelectedCheckout(checkout);
          setModalActive(true);
        }}>View & Log</Button>
      </InlineStack>,
    ];
  }) || [];

  const marketplaceRows = availableCheckouts?.map((checkout: any) => [
    checkout.checkoutId.slice(-8) + "...",
    checkout.email || "N/A",
    `${checkout.totalPrice} ${checkout.currency}`,
    <Badge tone="info">AVAILABLE</Badge>,
    new Date(checkout.createdAt).toLocaleDateString(),
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="claimCheckout" />
      <input type="hidden" name="checkoutId" value={checkout.id} />
      <Button size="slim" variant="primary" submit loading={isSubmitting && fetcher.formData?.get("checkoutId") === checkout.id}>
        Claim
      </Button>
    </fetcher.Form>,
  ]) || [];

  const commissionRows = salesRep?.commissions?.map((commission: any) => [
    commission.orderNumber || commission.orderId.slice(-8) + "...",
    `$${Number(commission.commissionAmount).toFixed(2)}`,
    <Badge tone={commission.status === "PAID" ? "success" : "warning"}>
      {commission.status}
    </Badge>,
    new Date(commission.createdAt).toLocaleDateString(),
  ]) || [];

  return (
    <Page>
      <TitleBar title="Recovery Workspace" />

      <BlockStack gap="500">
        <Layout>
          {/* Rep Profile & Stats */}
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">My Profile</Text>
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd">
                    <strong>Name:</strong> {salesRep?.firstName} {salesRep?.lastName}
                  </Text>
                  <Text as="p" variant="bodyMd">
                    <strong>Email:</strong> {salesRep?.email}
                  </Text>
                  <Text as="p" variant="bodyMd">
                    <strong>Tier:</strong> {salesRep?.tier || "BRONZE"}
                  </Text>
                  <Text as="p" variant="bodyMd">
                    <strong>Status:</strong> {salesRep.status}
                  </Text>
                </BlockStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">My Performance</Text>
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd">
                    <strong>Total Checkouts:</strong> {stats.totalCheckouts}
                  </Text>
                  <Text as="p" variant="bodyMd">
                    <strong>Recovered:</strong> {stats.recoveredCheckouts}
                  </Text>
                  <Text as="p" variant="bodyMd">
                    <strong>Recovery Rate:</strong> {stats.recoveryRate.toFixed(1)}%
                  </Text>
                  <Text as="p" variant="bodyMd">
                    <strong>Total Earnings:</strong> ${stats.totalEarnings.toFixed(2)}
                  </Text>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* My Checkouts */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">My Assigned Checkouts</Text>
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text"]}
                  headings={["Checkout ID", "Customer", "Amount", "Status", "Assigned", "Actions"]}
                  rows={checkoutRows}
                  hoverable
                />
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* My Commissions */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">My Commissions</Text>
                <DataTable
                  columnContentTypes={["text", "text", "text", "text"]}
                  headings={["Order", "Amount", "Status", "Date"]}
                  rows={commissionRows}
                  hoverable
                />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>

      {/* Checkout Details Modal */}
      {selectedCheckout && (
        <Modal
          open={modalActive}
          onClose={() => {
            setModalActive(false);
            setSelectedCheckout(null);
          }}
          title="Checkout Recovery Workspace"
          secondaryActions={[
            {
              content: "Close",
              onAction: () => {
                setModalActive(false);
                setSelectedCheckout(null);
              },
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="500">
              <Layout>
                <Layout.Section>
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingMd">Log New Activity</Text>
                    <fetcher.Form method="POST">
                      <input type="hidden" name="intent" value="logCommunication" />
                      <input type="hidden" name="checkoutId" value={selectedCheckout.id} />
                      <FormLayout>
                        <Select
                          label="Contact Channel"
                          name="channel"
                          options={[
                            { label: "WhatsApp", value: "WhatsApp" },
                            { label: "Email", value: "Email" },
                            { label: "Phone Call", value: "Phone" },
                            { label: "SMS", value: "SMS" },
                          ]}
                          value="WhatsApp"
                        />
                        <TextField
                          label="Communication Notes / Content"
                          name="content"
                          multiline={3}
                          autoComplete="off"
                          placeholder="Summarize what you said or paste the message here..."
                        />
                        <Button submit variant="primary" loading={isSubmitting}>
                          Log & Assess Quality
                        </Button>
                      </FormLayout>
                    </fetcher.Form>
                  </BlockStack>
                </Layout.Section>

                <Layout.Section variant="oneThird">
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingMd">Customer Info</Text>
                    <BlockStack gap="200">
                      <Text as="p" variant="bodyMd"><strong>Email:</strong> {selectedCheckout.email || "N/A"}</Text>
                      <Text as="p" variant="bodyMd"><strong>Value:</strong> {selectedCheckout.totalPrice} {selectedCheckout.currency}</Text>
                      {selectedCheckout.checkoutUrl && (
                        <Button variant="plain" url={selectedCheckout.checkoutUrl} external>View Checkout →</Button>
                      )}
                    </BlockStack>
                  </BlockStack>
                </Layout.Section>
              </Layout>

              <Divider />

              <BlockStack gap="400">
                <Text as="h3" variant="headingMd">Communication History & QC</Text>
                {selectedCheckout.communications?.length === 0 ? (
                  <Text as="p" tone="subdued">No activity logged yet.</Text>
                ) : (
                  <BlockStack gap="300">
                    {selectedCheckout.communications?.map((comm: any) => (
                      <Card key={comm.id} roundedAbove="sm">
                        <BlockStack gap="200">
                          <InlineStack align="space-between">
                            <InlineStack gap="200">
                              <Badge tone="info">{comm.channel}</Badge>
                              <Text as="span" variant="bodySm" tone="subdued">
                                {new Date(comm.createdAt).toLocaleString()}
                              </Text>
                            </InlineStack>
                            <Badge tone={comm.qcScore >= 80 ? "success" : comm.qcScore >= 60 ? "warning" : "critical"}>
                              {`QC Score: ${comm.qcScore}%`}
                            </Badge>
                          </InlineStack>
                          <Text as="p" variant="bodyMd">{comm.content}</Text>
                          {comm.qcFeedback && (
                            <Box padding="200" background="bg-surface-secondary" borderRadius="200">
                              <Text as="p" variant="bodySm" tone="magic">
                                <strong>AI Feedback:</strong> {comm.qcFeedback}
                              </Text>
                            </Box>
                          )}
                        </BlockStack>
                      </Card>
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* Action Messages */}
      {actionData?.success && (
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text tone="success" as="p">
                {actionData.message}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      )}

      {actionData?.error && (
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text tone="critical" as="p">
                Error: {actionData.error}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      )}
    </Page>
  );
}
