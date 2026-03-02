import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
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
  Select,
  Banner,
  EmptyState,
  Grid,
  Modal,
  Box,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Platform admin access control
  const PLATFORM_ADMIN_EMAIL = process.env.PLATFORM_ADMIN_EMAIL || "admin@reboundcart.com";
  if ((session as any).email !== PLATFORM_ADMIN_EMAIL) {
    throw new Response("Unauthorized: Platform admin access required", { status: 403 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status") || undefined;
  const claimed = url.searchParams.get("claimed") || undefined;

  let whereClause: any = {};

  if (status) {
    whereClause.status = status;
  }

  if (claimed === "true") {
    whereClause.claimedById = { not: null };
  } else if (claimed === "false") {
    whereClause.claimedById = null;
  }

  const checkouts = await db.abandonedCheckout.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" },
    include: {
      claimedBy: true,
      communications: { orderBy: { createdAt: "desc" } }
    },
    take: 100,
  });

  const stats = {
    total: await db.abandonedCheckout.count(),
    abandoned: await db.abandonedCheckout.count({ where: { status: "ABANDONED" } }),
    recovered: await db.abandonedCheckout.count({ where: { status: "RECOVERED" } }),
    unclaimed: await db.abandonedCheckout.count({ where: { claimedById: null } }),
  };

  const platformUsers = await db.platformUser.findMany({
    where: { status: "ACTIVE", role: "SALES_REP" },
  });

  return json({ checkouts, stats, platformUsers });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const PLATFORM_ADMIN_EMAIL = process.env.PLATFORM_ADMIN_EMAIL || "admin@reboundcart.com";
  if ((session as any).email !== PLATFORM_ADMIN_EMAIL) {
    throw new Response("Unauthorized", { status: 403 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");
  const checkoutId = formData.get("checkoutId") as string;

  if (intent === "claim") {
    const repId = formData.get("repId") as string;
    await db.abandonedCheckout.update({
      where: { id: checkoutId },
      data: { claimedById: repId, claimedAt: new Date() },
    });
    return json({ success: true });
  }

  if (intent === "unclaim") {
    await db.abandonedCheckout.update({
      where: { id: checkoutId },
      data: { claimedById: null, claimedAt: null },
    });
    return json({ success: true });
  }

  return json({ success: false });
};

export default function PlatformCheckoutsPage() {
  const { checkouts, stats, platformUsers } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [selectedCheckout, setSelectedCheckout] = useState<string | null>(null);
  const [selectedRep, setSelectedRep] = useState<string>("");
  const [modalActive, setModalActive] = useState(false);
  const [selectedCheckoutDetail, setSelectedCheckoutDetail] = useState<any>(null);
  const [detailModalActive, setDetailModalActive] = useState(false);

  const repChoices = [
    { label: "— Select a representative —", value: "" },
    ...platformUsers.map((rep: any) => ({
      label: `${rep.firstName || ""} ${rep.lastName || ""}`.trim() + ` (${rep.tier})`,
      value: rep.id,
    })),
  ];

  const checkoutRows = checkouts.map((checkout: any) => {
    const avgScore = checkout.communications?.length > 0
      ? Math.round(checkout.communications.reduce((sum: number, c: any) => sum + (c.qcScore || 0), 0) / checkout.communications.length)
      : null;

    return [
      checkout.shop.replace(".myshopify.com", ""),
      checkout.checkoutId.slice(-8) + "…",
      checkout.email || "N/A",
      `${Number(checkout.totalPrice).toFixed(2)} ${checkout.currency}`,
      <Badge tone={checkout.status === "RECOVERED" ? "success" : "attention"}>
        {checkout.status}
      </Badge>,
      checkout.claimedBy
        ? `${checkout.claimedBy.firstName || ""} ${checkout.claimedBy.lastName || ""}`.trim()
        : <Badge tone="new">Unclaimed</Badge>,
      avgScore !== null ? (
        <Badge tone={avgScore >= 80 ? "success" : avgScore >= 60 ? "warning" : "critical"}>
          {`${avgScore}%`}
        </Badge>
      ) : "N/A",
      <InlineStack gap="200">
        {!checkout.claimedBy && (
          <Button
            size="slim"
            variant="primary"
            onClick={() => {
              setSelectedCheckout(checkout.id);
              setSelectedRep("");
              setModalActive(true);
            }}
          >
            Assign
          </Button>
        )}
        {checkout.claimedBy && (
          <Button
            size="slim"
            variant="plain"
            tone="critical"
            onClick={() => {
              fetcher.submit(
                { intent: "unclaim", checkoutId: checkout.id },
                { method: "POST" }
              );
            }}
          >
            Unassign
          </Button>
        )}
        <Button
          size="slim"
          variant="plain"
          onClick={() => {
            setSelectedCheckoutDetail(checkout);
            setDetailModalActive(true);
          }}
        >
          View QC
        </Button>
      </InlineStack>,
    ];
  });

  return (
    <Page>
      <TitleBar title="Platformwide Checkouts" />

      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Grid>
              {[
                { label: "Total Checkouts", value: stats.total, tone: "base" },
                { label: "Abandoned", value: stats.abandoned, tone: "attention" },
                { label: "Recovered", value: stats.recovered, tone: "success" },
                { label: "Unassigned", value: stats.unclaimed, tone: "critical" },
              ].map(({ label, value, tone }) => (
                <Grid.Cell key={label} columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                  <Card>
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
                      <Text as="p" variant="headingLg" tone={tone as any} fontWeight="bold">{value}</Text>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
              ))}
            </Grid>
          </Layout.Section>
        </Layout>

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Every Single Checkout</Text>

                {checkouts.length === 0 ? (
                  <EmptyState
                    heading="No checkouts found across platform"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>When stores install ReboundCart and customers abandon carts, they will show up here.</p>
                  </EmptyState>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text", "text", "text", "numeric", "text"]}
                    headings={["Store", "ID", "Customer", "Amount", "Status", "Assigned", "QC Avg", "Actions"]}
                    rows={checkoutRows}
                    hoverable
                  />
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>

      {/* QC Detail Modal */}
      {selectedCheckoutDetail && (
        <Modal
          open={detailModalActive}
          onClose={() => {
            setDetailModalActive(false);
            setSelectedCheckoutDetail(null);
          }}
          title={`Communication Logs — ${selectedCheckoutDetail.email || "N/A"}`}
          secondaryActions={[{ content: "Close", onAction: () => setDetailModalActive(false) }]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              {selectedCheckoutDetail.communications?.length === 0 ? (
                <Text as="p" tone="subdued">No communication logged for this checkout.</Text>
              ) : (
                <BlockStack gap="300">
                  {selectedCheckoutDetail.communications?.map((comm: any) => (
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
                            {`Score: ${comm.qcScore}%`}
                          </Badge>
                        </InlineStack>
                        <Text as="p" variant="bodyMd">{comm.content}</Text>
                        <Box padding="200" background="bg-surface-secondary" borderRadius="200">
                          <Text as="p" variant="bodySm" tone="magic">
                            <strong>AI Analysis:</strong> {comm.qcFeedback}
                          </Text>
                        </Box>
                      </BlockStack>
                    </Card>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {selectedCheckout && (
        <Modal
          open={modalActive}
          onClose={() => {
            setModalActive(false);
            setSelectedCheckout(null);
            setSelectedRep("");
          }}
          title="Admin Manual Assignment"
          primaryAction={{
            content: "Assign",
            onAction: () => {
              if (selectedRep) {
                fetcher.submit(
                  { intent: "claim", checkoutId: selectedCheckout, repId: selectedRep },
                  { method: "POST" }
                );
                setModalActive(false);
                setSelectedCheckout(null);
                setSelectedRep("");
              }
            },
            disabled: !selectedRep,
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: () => {
                setModalActive(false);
                setSelectedCheckout(null);
                setSelectedRep("");
              },
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Text as="p" variant="bodyMd">
                As a platform admin, you can manually override any checkout assignment.
              </Text>
              <Select
                label="Select Representative"
                options={repChoices}
                value={selectedRep}
                onChange={setSelectedRep}
              />
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
