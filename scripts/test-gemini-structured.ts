import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY || "YOUR_GEMINI_API_KEY_HERE";
const genAI = new GoogleGenerativeAI(apiKey);

const agentVerdictSchema: any = {
  type: "object",
  properties: {
    agent: {
      type: "string",
      description: "Name of the agent evaluating the transaction."
    },
    risk_contribution: {
      type: "integer",
      description: "Risk score contribution from 0 to 100."
    },
    confidence: {
      type: "number",
      description: "Confidence value between 0.0 and 1.0."
    },
    reasoning: {
      type: "string",
      description: "One clear, natural-language sentence explaining the risk assessment."
    },
    flags: {
      type: "array",
      items: { type: "string" },
      description: "List of risk indicators triggered."
    }
  },
  required: ["agent", "risk_contribution", "confidence", "reasoning", "flags"]
};

async function testModel(modelName: string) {
  try {
    console.log(`Testing structured output with model: ${modelName}`);
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: agentVerdictSchema,
        temperature: 0.1
      }
    });

    const prompt = "Evaluate risk for a new device login at 3 AM from an unusual location. User typing speed is normal.";
    const result = await model.generateContent(prompt);
    console.log(`Success for ${modelName}! Result:`);
    console.log(result.response.text().trim());
    console.log("");
  } catch (err: any) {
    console.log(`Failed for ${modelName}: ${err.message}\n`);
  }
}

async function run() {
  await testModel("gemini-2.5-flash");
  await testModel("gemini-3-flash-preview");
}

run();
