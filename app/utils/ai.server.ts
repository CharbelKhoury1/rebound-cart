/**
 * AI Quality Control Utility
 * In a production environment, this would call an LLM like Gemini or OpenAI.
 * For now, it uses a heuristic analysis to simulate the behavior.
 */

export interface QCResult {
    score: number;
    feedback: string;
    sentiment: "Positive" | "Neutral" | "Negative";
}

export async function generateAIQualityAssessment(content: string): Promise<QCResult> {
    // Simulate API delay
    await new Promise((resolve) => setTimeout(resolve, 800));

    const text = content.toLowerCase();
    let score = 70; // Base score
    let feedback = "";
    let sentiment: "Positive" | "Neutral" | "Negative" = "Neutral";

    // Heuristic analysis
    const positiveWords = ["help", "sorry", "assist", "welcome", "pleasure", "discount", "offer", "free"];
    const negativeWords = ["buy", "now", "hurry", "pay", "money", "bad", "late"];
    const questionWords = ["?", "how", "what", "can I"];

    let positiveCount = 0;
    let negativeCount = 0;
    let hasQuestion = false;

    positiveWords.forEach(word => { if (text.includes(word)) positiveCount++; });
    negativeWords.forEach(word => { if (text.includes(word)) negativeCount++; });
    questionWords.forEach(word => { if (text.includes(word)) hasQuestion = true; });

    score += (positiveCount * 5);
    score -= (negativeCount * 3);
    if (hasQuestion) score += 10;
    if (text.length > 50) score += 5;
    if (text.length < 10) score -= 15;

    // Cap score
    score = Math.min(100, Math.max(0, score));

    // Determine sentiment
    if (positiveCount > negativeCount) sentiment = "Positive";
    else if (negativeCount > positiveCount) sentiment = "Negative";

    // Generate feedback
    if (score > 90) {
        feedback = "Excellent outreach! Professional, helpful, and engaging.";
    } else if (score > 75) {
        feedback = "Good work. The tone is appropriate and helpful.";
    } else if (score > 50) {
        feedback = "Fair. Try to be more descriptive and focused on the customer's needs.";
    } else {
        feedback = "Needs improvement. Tone may be too aggressive or the message is too short.";
    }

    return { score, feedback, sentiment };
}
