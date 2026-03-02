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
  FormLayout,
  TextField,
  Select,
  Badge,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  // Get assignment rules for display
  const assignmentRules = await db.assignmentRule.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
  });

  return json({ assignmentRules });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "signup") {
    const email = formData.get("email") as string;
    const firstName = formData.get("firstName") as string;
    const lastName = formData.get("lastName") as string;
    const phone = formData.get("phone") as string;
    const experience = formData.get("experience") as string;
    const skills = formData.get("skills") as string;
    const tier = formData.get("tier") as string;

    if (!email || !firstName || !lastName) {
      return json({ success: false, error: "Please fill in all required fields" }, { status: 400 });
    }

    try {
      await db.platformUser.create({
        data: {
          email,
          firstName,
          lastName,
          role: "SALES_REP",
          tier: tier || "BRONZE",
          status: "PENDING", // Requires approval
        },
      });
      return json({ success: true, message: "Application submitted for review" });
    } catch (error) {
      return json({ success: false, error: "Failed to submit application" }, { status: 500 });
    }
  }

  return json({ success: false, error: "Invalid action" }, { status: 400 });
};

export default function PublicSignupPage() {
  const { assignmentRules } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState({
    email: "",
    firstName: "",
    lastName: "",
    phone: "",
    experience: "",
    skills: "",
    tier: "BRONZE",
  });

  const tierDescriptions = {
    BRONZE: "15% commission rate, entry-level tier",
    SILVER: "18% commission rate, experienced representatives",
    GOLD: "20% commission rate, top performers",
    PLATINUM: "25% commission rate, elite representatives",
  };

  const handleNextStep = () => {
    if (currentStep < 4) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Form submission handled by fetcher
  };

  return (
    <Page>
      <TitleBar title="Join ReboundCart Marketplace" />
      
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Become a Sales Representative</Text>
                <Text as="p" variant="bodyMd">
                  Join our marketplace of verified sales representatives and help Shopify stores recover abandoned carts.
                </Text>
                
                {/* Progress Steps */}
                <InlineStack gap="200">
                  {[1, 2, 3, 4].map((step) => (
                    <div
                      key={step}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "40px",
                        height: "40px",
                        borderRadius: "50%",
                        backgroundColor: currentStep === step ? "#007ace" : "#f3f4f6",
                        color: "white",
                        fontWeight: "bold",
                        margin: "0 8px 0",
                      }}
                    >
                      {step}
                    </div>
                  ))}
                </InlineStack>
                
                {/* Application Form */}
                {currentStep === 1 && (
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingMd">Step 1: Personal Information</Text>
                    <fetcher.Form method="POST" onSubmit={handleSubmit}>
                      <input type="hidden" name="intent" value="signup" />
                      <FormLayout>
                        <TextField
                          name="firstName"
                          label="First Name"
                          value={formData.firstName}
                          onChange={(value) => setFormData({ ...formData, firstName: value })}
                          required
                        />
                        <TextField
                          name="lastName"
                          label="Last Name"
                          value={formData.lastName}
                          onChange={(value) => setFormData({ ...formData, lastName: value })}
                          required
                        />
                        <TextField
                          name="email"
                          label="Email"
                          type="email"
                          value={formData.email}
                          onChange={(value) => setFormData({ ...formData, email: value })}
                          required
                        />
                        <TextField
                          name="phone"
                          label="Phone"
                          type="tel"
                          value={formData.phone}
                          onChange={(value) => setFormData({ ...formData, phone: value })}
                        />
                      </FormLayout>
                      <InlineStack gap="200">
                        <Button onClick={() => setCurrentStep(2)}>Continue</Button>
                      </InlineStack>
                    </fetcher.Form>
                  </BlockStack>
                )}

                {currentStep === 2 && (
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingMd">Step 2: Experience & Skills</Text>
                    <fetcher.Form method="POST" onSubmit={handleSubmit}>
                      <input type="hidden" name="intent" value="signup" />
                      <FormLayout>
                        <TextField
                          name="experience"
                          label="Years of Sales Experience"
                          type="number"
                          value={formData.experience}
                          onChange={(value) => setFormData({ ...formData, experience: value })}
                          required
                        />
                        <TextField
                          name="skills"
                          label="Relevant Skills"
                          value={formData.skills}
                          onChange={(value) => setFormData({ ...formData, skills: value })}
                          multiline={4}
                          placeholder="e.g., Customer service, sales, e-commerce, fluent English"
                        />
                      </FormLayout>
                      <InlineStack gap="200">
                        <Button onClick={() => setCurrentStep(1)}>Back</Button>
                        <Button onClick={() => setCurrentStep(3)}>Continue</Button>
                      </InlineStack>
                    </fetcher.Form>
                  </BlockStack>
                )}

                {currentStep === 3 && (
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingMd">Step 3: Choose Your Tier</Text>
                    <fetcher.Form method="POST" onSubmit={handleSubmit}>
                      <input type="hidden" name="intent" value="signup" />
                      <FormLayout>
                        <Select
                          name="tier"
                          label="Select Your Tier"
                          options={[
                            { label: "Bronze - " + tierDescriptions.BRONZE, value: "BRONZE" },
                            { label: "Silver - " + tierDescriptions.SILVER, value: "SILVER" },
                            { label: "Gold - " + tierDescriptions.GOLD, value: "GOLD" },
                            { label: "Platinum - " + tierDescriptions.PLATINUM, value: "PLATINUM" },
                          ]}
                          value={formData.tier}
                          onChange={(value) => setFormData({ ...formData, tier: value })}
                        />
                        <Text as="p" variant="bodySm" tone="subdued">
                          Commission rates are based on your tier and performance. Higher tiers offer better commission rates and premium features.
                        </Text>
                      </FormLayout>
                      <InlineStack gap="200">
                        <Button onClick={() => setCurrentStep(2)}>Back</Button>
                        <Button onClick={() => setCurrentStep(4)}>Continue</Button>
                      </InlineStack>
                    </fetcher.Form>
                  </BlockStack>
                )}

                {currentStep === 4 && (
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingMd">Step 4: Review & Submit</Text>
                    <BlockStack gap="200">
                      <Card>
                        <BlockStack gap="200">
                          <Text as="p" variant="bodyMd"><strong>Name:</strong> {formData.firstName} {formData.lastName}</Text>
                          <Text as="p" variant="bodyMd"><strong>Email:</strong> {formData.email}</Text>
                          <Text as="p" variant="bodyMd"><strong>Phone:</strong> {formData.phone}</Text>
                          <Text as="p" variant="bodyMd"><strong>Experience:</strong> {formData.experience} years</Text>
                          <Text as="p" variant="bodyMd"><strong>Skills:</strong> {formData.skills}</Text>
                          <Text as="p" variant="bodyMd"><strong>Tier:</strong> {formData.tier}</Text>
                        </BlockStack>
                      </Card>
                      <fetcher.Form method="POST" onSubmit={handleSubmit}>
                        <input type="hidden" name="intent" value="signup" />
                        <input type="hidden" name="firstName" value={formData.firstName} />
                        <input type="hidden" name="lastName" value={formData.lastName} />
                        <input type="hidden" name="email" value={formData.email} />
                        <input type="hidden" name="phone" value={formData.phone} />
                        <input type="hidden" name="experience" value={formData.experience} />
                        <input type="hidden" name="skills" value={formData.skills} />
                        <input type="hidden" name="tier" value={formData.tier} />
                        <InlineStack gap="200">
                          <Button onClick={() => setCurrentStep(3)}>Back</Button>
                          <Button submit variant="primary">Submit Application</Button>
                        </InlineStack>
                      </fetcher.Form>
                    </BlockStack>
                  </BlockStack>
                )}
              </BlockStack>

              {/* Assignment Rules Display */}
              <Divider />
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">Current Assignment Rules</Text>
                {assignmentRules.length === 0 ? (
                  <Text as="p" variant="bodyMd">No assignment rules configured yet.</Text>
                ) : (
                  assignmentRules.map((rule) => (
                    <Card key={rule.id}>
                      <BlockStack gap="200">
                        <Text as="h4" variant="headingSm">{rule.name}</Text>
                        <Text as="p" variant="bodyMd">{rule.description}</Text>
                        <Text as="p" variant="bodySm">
                          <strong>Conditions:</strong> {JSON.stringify(rule.conditions, null, 2)}
                        </Text>
                      </BlockStack>
                    </Card>
                  ))
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
