import { PrismaClient } from "@prisma/client";
import { generateAIQualityAssessment } from "./app/utils/ai.server";

const prisma = new PrismaClient();

async function main() {
    console.log("🚀 Starting End-to-End Recovery Flow Verification...");

    const testShop = "test-store-verify.myshopify.com";
    const testEmail = "rep@example.com";

    try {
        // 1. Setup Mock Data
        console.log("Step 1: Setting up mock Sales Rep and Shop...");
        const rep = await prisma.platformUser.upsert({
            where: { email: testEmail },
            update: { status: "ACTIVE", role: "SALES_REP" },
            create: {
                email: testEmail,
                firstName: "Test",
                lastName: "Rep",
                role: "SALES_REP",
                status: "ACTIVE",
                tier: "GOLD",
            },
        });

        await (prisma.shopSettings as any).upsert({
            where: { shop: testShop },
            update: { isMarketplaceEnabled: true },
            create: {
                shop: testShop,
                commissionRate: 15.0,
                isMarketplaceEnabled: true,
            },
        });

        // 2. Mock Abandoned Checkout
        console.log("Step 2: Creating mock Abandoned Checkout...");
        const checkoutId = "gid://shopify/AbandonedCheckout/" + Date.now();
        const checkout = await prisma.abandonedCheckout.upsert({
            where: { checkoutId },
            update: {},
            create: {
                shop: testShop,
                checkoutId,
                email: "customer@example.com",
                totalPrice: 150.00,
                currency: "USD",
                status: "ABANDONED",
            },
        });

        // 3. Simulate Claim
        console.log("Step 3: Simulating Sales Rep claiming checkout...");
        const claimedCheckout = await prisma.abandonedCheckout.update({
            where: { id: checkout.id },
            data: {
                claimedById: rep.id,
                claimedAt: new Date(),
            },
        });

        if (claimedCheckout.claimedById !== rep.id) throw new Error("Claim failed!");
        console.log("✅ Checkout successfully claimed by Rep.");

        // 4. Simulate Communication with AI QC
        console.log("Step 4: Simulating communication log with AI QC...");
        const content = "Hi! I saw you left some items in your cart. Can I assist you with a 10% discount?";
        const qc = await generateAIQualityAssessment(content);

        console.log(`AI Score: ${qc.score}% | Sentiment: ${qc.sentiment}`);
        console.log(`AI Feedback: ${qc.feedback}`);

        const comm = await prisma.communication.create({
            data: {
                checkoutId: checkout.id,
                repId: rep.id,
                channel: "WhatsApp",
                content,
                qcScore: qc.score,
                qcFeedback: qc.feedback,
                sentiment: qc.sentiment,
            },
        });

        if (!comm.id) throw new Error("Communication log failed!");
        console.log("✅ AI-powered communication log verified.");

        console.log("\n✨ END-TO-END FLOW VERIFIED SUCCESSFULLY! ✨");

    } catch (error) {
        console.error("❌ Verification Failed:", error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
