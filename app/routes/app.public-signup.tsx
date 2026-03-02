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
  Banner,
  Divider,
  Badge,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const assignmentRules = await db.assignmentRule.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
  });

  return json({ assignmentRules });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "signup") {
    const email = formData.get("email") as string;
    const firstName = formData.get("firstName") as string;
    const lastName = formData.get("lastName") as string;
    const phone = formData.get("phone") as string | null;
    const experience = formData.get("experience") as string | null;
    const skills = formData.get("skills") as string | null;
    const tier = formData.get("tier") as string;

    if (!email || !firstName || !lastName) {
      return json({ success: false, error: "Please fill in all required fields" }, { status: 400 });
    }

    try {
      // Check if user already exists
      const existing = await db.platformUser.findUnique({ where: { email } });
      if (existing) {
        return json({ success: false, error: "A user with this email already exists" }, { status: 400 });
      }

      await db.platformUser.create({
        data: {
          email,
          firstName,
          lastName,
          phone: phone || null,
          role: "SALES_REP",
          tier: tier || "BRONZE",
          status: "PENDING",
          experience: experience || null,
          skills: skills || null,
        },
      });
      return json({ success: true, message: "Application submitted successfully! You will be reviewed within 48 hours." });
    } catch (error) {
      return json({ success: false, error: "Failed to submit application. Please try again." }, { status: 500 });
    }
  }

  return json({ success: false, error: "Invalid action" }, { status: 400 });
};

const TIER_DESCRIPTIONS: Record<string, { commission: string; description: string }> = {
  BRONZE: { commission: "15%", description: "Entry-level tier for new representatives" },
  SILVER: { commission: "18%", description: "Experienced representatives with proven track record" },
  GOLD: { commission: "20%", description: "Top performers with exceptional results" },
  PLATINUM: { commission: "25%", description: "Elite representatives — invite only" },
};

export default function PublicSignupPage() {
  const { assignmentRules } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const fetcher = useFetcher();
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

  const isSubmitting = fetcher.state === "submitting";
  const fetcherData = fetcher.data as { success?: boolean; message?: string; error?: string } | undefined;
  const isSuccess = fetcherData?.success === true;

  const steps = [
    { label: "Personal Info", step: 1 },
    { label: "Experience", step: 2 },
    { label: "Choose Tier", step: 3 },
    { label: "Review & Submit", step: 4 },
  ];

  return (
    <Page>
      <TitleBar title="Join ReboundCart Marketplace" />

      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            {/* Success Banner */}
            {isSuccess && (
              <Banner tone="success" title="Application Submitted!">
                <p>{fetcherData?.message}</p>
              </Banner>
            )}

            {/* Error Banner */}
            {fetcherData?.success === false && (
              <Banner tone="critical" title="Submission Error">
                <p>{fetcherData?.error}</p>
              </Banner>
            )}
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="500">
                {/* Header */}
                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">Become a Sales Representative</Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Join our marketplace of verified sales representatives and help Shopify stores recover abandoned carts. Earn commissions on every successful recovery.
                  </Text>
                </BlockStack>

                {/* Step Indicator */}
                <InlineStack gap="300" align="center">
                  {steps.map(({ label, step }) => (
                    <BlockStack key={step} gap="100" inlineAlign="center">
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: "40px",
                          height: "40px",
                          borderRadius: "50%",
                          backgroundColor:
                            currentStep === step
                              ? "var(--p-color-bg-fill-brand)"
                              : currentStep > step
                                ? "var(--p-color-bg-fill-success)"
                                : "var(--p-color-bg-fill-secondary)",
                          color:
                            currentStep >= step ? "white" : "var(--p-color-text-secondary)",
                          fontWeight: "bold",
                          fontSize: "14px",
                          transition: "all 0.2s ease",
                        }}
                      >
                        {currentStep > step ? "✓" : step}
                      </div>
                      <Text as="p" variant="bodySm" tone={currentStep === step ? "base" : "subdued"}>
                        {label}
                      </Text>
                    </BlockStack>
                  ))}
                </InlineStack>

                <Divider />

                {/* Step 1: Personal Information */}
                {currentStep === 1 && !isSuccess && (
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingMd">Step 1: Personal Information</Text>
                    <FormLayout>
                      <FormLayout.Group>
                        <TextField
                          label="First Name"
                          value={formData.firstName}
                          onChange={(value) => setFormData({ ...formData, firstName: value })}
                          autoComplete="given-name"
                          requiredIndicator
                        />
                        <TextField
                          label="Last Name"
                          value={formData.lastName}
                          onChange={(value) => setFormData({ ...formData, lastName: value })}
                          autoComplete="family-name"
                          requiredIndicator
                        />
                      </FormLayout.Group>
                      <TextField
                        label="Email"
                        type="email"
                        value={formData.email}
                        onChange={(value) => setFormData({ ...formData, email: value })}
                        autoComplete="email"
                        requiredIndicator
                      />
                      <TextField
                        label="Phone (optional)"
                        type="tel"
                        value={formData.phone}
                        onChange={(value) => setFormData({ ...formData, phone: value })}
                        autoComplete="tel"
                      />
                    </FormLayout>
                    <InlineStack align="end">
                      <Button
                        variant="primary"
                        onClick={() => {
                          if (!formData.firstName || !formData.lastName || !formData.email) {
                            return;
                          }
                          setCurrentStep(2);
                        }}
                        disabled={!formData.firstName || !formData.lastName || !formData.email}
                      >
                        Continue →
                      </Button>
                    </InlineStack>
                  </BlockStack>
                )}

                {/* Step 2: Experience & Skills */}
                {currentStep === 2 && !isSuccess && (
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingMd">Step 2: Experience & Skills</Text>
                    <FormLayout>
                      <TextField
                        label="Years of Sales Experience"
                        type="number"
                        value={formData.experience}
                        onChange={(value) => setFormData({ ...formData, experience: value })}
                        helpText="How many years have you worked in sales or customer service?"
                        autoComplete="off"
                      />
                      <TextField
                        label="Relevant Skills"
                        value={formData.skills}
                        onChange={(value) => setFormData({ ...formData, skills: value })}
                        multiline={4}
                        placeholder="e.g., Customer service, e-commerce sales, fluent in English & Arabic, CRM tools..."
                        helpText="Describe your sales skills and relevant experience"
                        autoComplete="off"
                      />
                    </FormLayout>
                    <InlineStack align="space-between">
                      <Button onClick={() => setCurrentStep(1)}>← Back</Button>
                      <Button variant="primary" onClick={() => setCurrentStep(3)}>Continue →</Button>
                    </InlineStack>
                  </BlockStack>
                )}

                {/* Step 3: Choose Tier */}
                {currentStep === 3 && !isSuccess && (
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingMd">Step 3: Choose Your Starting Tier</Text>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Your tier determines your commission rate. Tiers are validated by our team based on your experience and performance.
                    </Text>

                    <BlockStack gap="300">
                      {Object.entries(TIER_DESCRIPTIONS).map(([tierKey, info]) => (
                        <div
                          key={tierKey}
                          onClick={() => setFormData({ ...formData, tier: tierKey })}
                          style={{
                            padding: "16px",
                            border: `2px solid ${formData.tier === tierKey ? "var(--p-color-border-brand)" : "var(--p-color-border)"}`,
                            borderRadius: "8px",
                            cursor: "pointer",
                            backgroundColor: formData.tier === tierKey ? "var(--p-color-bg-surface-brand)" : "transparent",
                            transition: "all 0.15s ease",
                          }}
                        >
                          <InlineStack align="space-between">
                            <BlockStack gap="100">
                              <InlineStack gap="200">
                                <Text as="p" variant="headingSm">{tierKey}</Text>
                                <Badge
                                  tone={
                                    tierKey === "PLATINUM" ? "magic" :
                                      tierKey === "GOLD" ? "warning" :
                                        tierKey === "SILVER" ? "attention" :
                                          "new"
                                  }
                                >
                                  {info.commission}
                                </Badge>
                              </InlineStack>
                              <Text as="p" variant="bodySm" tone="subdued">{info.description}</Text>
                            </BlockStack>
                            {formData.tier === tierKey && (
                              <Text as="p" variant="bodyMd">✓</Text>
                            )}
                          </InlineStack>
                        </div>
                      ))}
                    </BlockStack>

                    <InlineStack align="space-between">
                      <Button onClick={() => setCurrentStep(2)}>← Back</Button>
                      <Button variant="primary" onClick={() => setCurrentStep(4)}>Continue →</Button>
                    </InlineStack>
                  </BlockStack>
                )}

                {/* Step 4: Review & Submit */}
                {currentStep === 4 && !isSuccess && (
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingMd">Step 4: Review & Submit</Text>

                    <Card>
                      <BlockStack gap="300">
                        <Text as="h4" variant="headingSm">Application Summary</Text>
                        <BlockStack gap="200">
                          <InlineStack gap="200">
                            <Text as="p" variant="bodyMd" fontWeight="semibold">Name:</Text>
                            <Text as="p" variant="bodyMd">{formData.firstName} {formData.lastName}</Text>
                          </InlineStack>
                          <InlineStack gap="200">
                            <Text as="p" variant="bodyMd" fontWeight="semibold">Email:</Text>
                            <Text as="p" variant="bodyMd">{formData.email}</Text>
                          </InlineStack>
                          {formData.phone && (
                            <InlineStack gap="200">
                              <Text as="p" variant="bodyMd" fontWeight="semibold">Phone:</Text>
                              <Text as="p" variant="bodyMd">{formData.phone}</Text>
                            </InlineStack>
                          )}
                          <InlineStack gap="200">
                            <Text as="p" variant="bodyMd" fontWeight="semibold">Experience:</Text>
                            <Text as="p" variant="bodyMd">{formData.experience ? `${formData.experience} year(s)` : "Not specified"}</Text>
                          </InlineStack>
                          <InlineStack gap="200">
                            <Text as="p" variant="bodyMd" fontWeight="semibold">Requested Tier:</Text>
                            <Badge
                              tone={
                                formData.tier === "PLATINUM" ? "magic" :
                                  formData.tier === "GOLD" ? "warning" :
                                    formData.tier === "SILVER" ? "attention" :
                                      "new"
                              }
                            >
                              {`${formData.tier} — ${TIER_DESCRIPTIONS[formData.tier]?.commission} commission`}
                            </Badge>
                          </InlineStack>
                          {formData.skills && (
                            <BlockStack gap="100">
                              <Text as="p" variant="bodyMd" fontWeight="semibold">Skills:</Text>
                              <Text as="p" variant="bodyMd" tone="subdued">{formData.skills}</Text>
                            </BlockStack>
                          )}
                        </BlockStack>
                      </BlockStack>
                    </Card>

                    <Banner tone="info">
                      <p>Your application will be reviewed within 48 hours. You'll receive an email notification once approved.</p>
                    </Banner>

                    <fetcher.Form method="POST">
                      <input type="hidden" name="intent" value="signup" />
                      <input type="hidden" name="firstName" value={formData.firstName} />
                      <input type="hidden" name="lastName" value={formData.lastName} />
                      <input type="hidden" name="email" value={formData.email} />
                      <input type="hidden" name="phone" value={formData.phone} />
                      <input type="hidden" name="experience" value={formData.experience} />
                      <input type="hidden" name="skills" value={formData.skills} />
                      <input type="hidden" name="tier" value={formData.tier} />
                      <InlineStack align="space-between">
                        <Button onClick={() => setCurrentStep(3)}>← Back</Button>
                        <Button submit variant="primary" loading={isSubmitting}>
                          Submit Application
                        </Button>
                      </InlineStack>
                    </fetcher.Form>
                  </BlockStack>
                )}

                {/* Success state */}
                {isSuccess && (
                  <BlockStack gap="400" inlineAlign="center">
                    <div style={{ textAlign: "center", padding: "40px 0" }}>
                      <Text as="p" variant="headingXl">🎉</Text>
                      <BlockStack gap="200" inlineAlign="center">
                        <Text as="h3" variant="headingMd">Application Submitted!</Text>
                        <Text as="p" variant="bodyMd" tone="subdued">
                          Our team will review your application within 48 hours and contact you at {formData.email}.
                        </Text>
                      </BlockStack>
                    </div>
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Assignment Rules Sidebar */}
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <Text as="h3" variant="headingMd">Active Assignment Rules</Text>
                {assignmentRules.length === 0 ? (
                  <Text as="p" variant="bodyMd" tone="subdued">No assignment rules configured yet.</Text>
                ) : (
                  assignmentRules.map((rule) => (
                    <div key={rule.id} style={{ padding: "12px", border: "1px solid var(--p-color-border)", borderRadius: "8px" }}>
                      <BlockStack gap="100">
                        <Text as="h4" variant="headingSm">{rule.name}</Text>
                        {rule.description && (
                          <Text as="p" variant="bodySm" tone="subdued">{rule.description}</Text>
                        )}
                      </BlockStack>
                    </div>
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
