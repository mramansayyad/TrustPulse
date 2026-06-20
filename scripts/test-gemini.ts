import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY || "YOUR_GEMINI_API_KEY_HERE";
const genAI = new GoogleGenerativeAI(apiKey);

async function test() {
  const modelsToTest = ["gemini-1.5-flash", "gemini-1.5-flash-latest", "gemini-2.5-flash", "gemini-3-flash-preview"];
  for (const modelName of modelsToTest) {
    try {
      console.log(`Testing model: ${modelName}`);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent("Hello, write a 3-word response.");
      console.log(`Success! Response: "${result.response.text().trim()}"\n`);
    } catch (err: any) {
      console.log(`Failed for ${modelName}: ${err.message}\n`);
    }
  }
}

test();
