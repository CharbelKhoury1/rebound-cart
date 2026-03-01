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
  TextField,
  Badge,
  Modal,
  ChoiceList,
  FormLayout,
  Icon,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  const salesReps = await db.salesRep.findMany({
    orderBy: { createdAt: "desc" },
  });

  return json({ salesReps });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create") {
    const email = formData.get("email") as string;
    const firstName = formData.get("firstName") as string;
    const lastName = formData.get("lastName") as string;
    const role = formData.get("role") as string;

    if (!email) {
      return json({ success: false, error: "Email is required" }, { status: 400 });
    }

    try {
      await db.salesRep.create({
        data: {
          email,
          firstName: firstName || null,
          lastName: lastName || null,
          role: role || "REP",
        },
      });
      return json({ success: true });
    } catch (error) {
      return json({ success: false, error: "Failed to create sales rep" }, { status: 500 });
    }
  }

  return json({ success: false, error: "Invalid action" }, { status: 400 });
};

export default function SalesRepsPage() {
  const { salesReps } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [modalActive, setModalActive] = useState(false);
  const fetcher = useFetcher();

  const repRows = salesReps.map((rep) => [
    `${rep.firstName} ${rep.lastName}`,
    rep.email,
    <Badge tone={rep.role === "ADMIN" ? "info" as const : "success" as const}>
      {rep.role}
    </Badge>,
    new Date(rep.createdAt).toLocaleDateString(),
    <InlineStack gap="200">
      <Button size="slim" variant="plain">Edit</Button>
      <Button size="slim" variant="plain" tone="critical">Remove</Button>
    </InlineStack>,
  ]);

  return (
    <Page>
      <TitleBar title="Sales Representatives" />
      
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">Sales Team</Text>
                  <Button onClick={() => setModalActive(true)}>Add Sales Rep</Button>
                </InlineStack>
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text"]}
                  headings={["Name", "Email", "Role", "Joined", "Actions"]}
                  rows={repRows}
                  hoverable
                />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>

      <Modal
        open={modalActive}
        onClose={() => setModalActive(false)}
        title="Add Sales Representative"
        primaryAction={{
          content: "Add Rep",
          onAction: () => {
            const form = document.getElementById("rep-form") as HTMLFormElement;
            if (form) form.requestSubmit();
            setModalActive(false);
          },
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setModalActive(false),
          },
        ]}
      >
        <Modal.Section>
          <fetcher.Form method="POST" id="rep-form">
            <input type="hidden" name="intent" value="create" />
            <FormLayout>
              <TextField
                name="email"
                label="Email"
                type="email"
                autoComplete="email"
              />
              <TextField
                name="firstName"
                label="First Name"
                autoComplete="given-name"
              />
              <TextField
                name="lastName"
                label="Last Name"
                autoComplete="family-name"
              />
              <ChoiceList
                name="role"
                title="Role"
                choices={[
                  { label: "Sales Representative", value: "REP" },
                  { label: "Admin", value: "ADMIN" },
                ]}
                selected={["REP"]}
              />
            </FormLayout>
          </fetcher.Form>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
