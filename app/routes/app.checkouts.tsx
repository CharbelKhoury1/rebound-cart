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
  Filters,
  ChoiceList,
  TextField,
  Select,
  Modal,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || undefined;
  const claimed = url.searchParams.get("claimed") || undefined;

  let whereClause: any = { shop };

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
    include: { claimedBy: true },
    take: 50,
  });

  const salesReps = await db.salesRep.findMany({
    orderBy: { firstName: "asc" },
  });

  return json({ checkouts, salesReps });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");
  const checkoutId = formData.get("checkoutId") as string;
  const repId = formData.get("repId") as string;

  if (intent === "claim" && checkoutId && repId) {
    try {
      await db.abandonedCheckout.update({
        where: { id: checkoutId },
        data: {
          claimedById: repId,
          claimedAt: new Date(),
        },
      });
      return json({ success: true });
    } catch (error) {
      return json({ success: false, error: "Failed to claim checkout" }, { status: 500 });
    }
  }

  if (intent === "unclaim" && checkoutId) {
    try {
      await db.abandonedCheckout.update({
        where: { id: checkoutId },
        data: {
          claimedById: null,
          claimedAt: null,
        },
      });
      return json({ success: true });
    } catch (error) {
      return json({ success: false, error: "Failed to unclaim checkout" }, { status: 500 });
    }
  }

  return json({ success: false, error: "Invalid action" }, { status: 400 });
};

export default function CheckoutsPage() {
  const { checkouts, salesReps } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [selectedCheckout, setSelectedCheckout] = useState<string | null>(null);
  const [selectedRep, setSelectedRep] = useState<string>("");
  const [modalActive, setModalActive] = useState(false);
  const fetcher = useFetcher();

  const checkoutRows = checkouts.map((checkout) => [
    checkout.checkoutId.slice(-8) + "...",
    checkout.email || "N/A",
    `${checkout.totalPrice} ${checkout.currency}`,
    <Badge tone={checkout.status === "RECOVERED" ? "success" : "attention"}>
      {checkout.status}
    </Badge>,
    checkout.claimedBy ? `${checkout.claimedBy.firstName} ${checkout.claimedBy.lastName}` : "Unclaimed",
    new Date(checkout.createdAt).toLocaleDateString(),
    <InlineStack gap="200">
      {!checkout.claimedBy && (
        <Button
          size="slim"
          variant="primary"
          onClick={() => {
            setSelectedCheckout(checkout.id);
            setModalActive(true);
          }}
        >
          Claim
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
          Unclaim
        </Button>
      )}
    </InlineStack>,
  ]);

  const repChoices = salesReps.map((rep) => ({
    label: `${rep.firstName} ${rep.lastName} (${rep.email})`,
    value: rep.id,
  }));

  return (
    <Page>
      <TitleBar title="Abandoned Checkouts" />
      
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">All Abandoned Checkouts</Text>
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text", "text", "text"]}
                  headings={["Checkout ID", "Customer", "Amount", "Status", "Assigned Rep", "Created", "Actions"]}
                  rows={checkoutRows}
                  hoverable
                />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>

      {/* Claim Modal */}
      {selectedCheckout && (
        <Modal
          open={modalActive}
          onClose={() => setModalActive(false)}
          title="Claim Checkout"
          primaryAction={{
            content: "Claim",
            onAction: () => {
              if (selectedRep) {
                fetcher.submit(
                  { 
                    intent: "claim", 
                    checkoutId: selectedCheckout, 
                    repId: selectedRep 
                  },
                  { method: "POST" }
                );
                setModalActive(false);
                setSelectedCheckout(null);
                setSelectedRep("");
              }
            },
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
              <Text as="p">Select a sales representative to claim this checkout:</Text>
              <Select
                label="Sales Representative"
                options={repChoices}
                value={selectedRep}
                onChange={setSelectedRep}
                placeholder="Choose a sales rep"
              />
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
