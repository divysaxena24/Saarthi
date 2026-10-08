import {
    BedrockRuntimeClient,
    ConverseCommand,
    Message
} from "@aws-sdk/client-bedrock-runtime";
import Groq from "groq-sdk";

// Initialize Amazon Bedrock client for all Generation/Chat capabilities
export const bedrockClient = new BedrockRuntimeClient({
    region: process.env.MY_AWS_REGION || "us-east-1",
    credentials: {
        accessKeyId: process.env.MY_AWS_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.MY_AWS_SECRET_ACCESS_KEY || "",
    }
});

// Initialize Groq client purely for Speech-to-Text (Whisper) support
// since AWS Transcribe stream configuration is out of scope for immediate migration.
export const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY || "gsk_placeholder_build_key",
});

/**
 * Helper function to generate a completion using Amazon Bedrock.
 * Renamed internally from generateGroqCompletion to maintain API compatibility
 * while swapping the backend to AWS.
 */
export async function generateGroqCompletion(
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    options?: {
        model?: string;
        temperature?: number;
        max_tokens?: number;
        response_format?: { type: "json_object" };
    }
) {
    try {
        const systemMessages = messages.filter(m => m.role === "system").map(m => ({ text: m.content }));
        let conversationMessages: Message[] = messages
            .filter(m => m.role !== "system")
            .map(m => ({
                role: m.role as "user" | "assistant",
                content: [{ text: m.content }]
            }));

        // AWS Bedrock Converse API strictly requires at least one message in the conversation array, 
        // and it typically must start with a user message.
        if (conversationMessages.length === 0) {
            conversationMessages.push({
                role: "user",
                content: [{ text: "Please process the request according to the system instructions." }]
            });
        } else if (conversationMessages[0].role !== "user") {
            // Unshift a dummy user message if it starts with an assistant message
            conversationMessages.unshift({
                role: "user",
                content: [{ text: "Start" }]
            });
        }

        // Validate and sanitize bedrockModelId to prevent passing Groq model names to AWS Bedrock
        const bedrockModelId = (options?.model && (options.model.includes("amazon.") || options.model.includes("meta.") || options.model.includes("anthropic.")))
            ? options.model
            : "amazon.nova-lite-v1:0";

        const command = new ConverseCommand({
            modelId: bedrockModelId,
            system: systemMessages.length > 0 ? systemMessages : undefined,
            messages: conversationMessages,
            inferenceConfig: {
                temperature: options?.temperature ?? 0.7,
                maxTokens: options?.max_tokens ?? 4096,
            }
        });

        const response = await bedrockClient.send(command);
        let textResult = response.output?.message?.content?.[0]?.text || "";

        // Robust JSON extraction: 
        // 1. Strip Markdown code blocks if they exist
        // 2. If it still fails, attempt to find the first '{' and last '}'
        if (options?.response_format?.type === "json_object") {
            const jsonBlockMatch = textResult.match(/```json\n([\s\S]*?)\n```/) || textResult.match(/```([\s\S]*?)```/);
            if (jsonBlockMatch) {
                textResult = jsonBlockMatch[1];
            } else {
                const firstBrace = textResult.indexOf('{');
                const lastBrace = textResult.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                    textResult = textResult.substring(firstBrace, lastBrace + 1);
                }
            }
        }

        return textResult.trim();
    } catch (error: any) {
        console.error("AWS Bedrock API Error Details:", error);
        throw new Error(`Failed to generate response from AWS Bedrock: ${error.message || JSON.stringify(error)}`);
    }
}

/**
 * Migration shim: keeps the old 'chatWithGroq' signature but routes to Bedrock.
 */
export async function chatWithGroq(
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    options: any = {}
) {
    try {
        const textResponse = await generateGroqCompletion(messages, options);

        // Mock the Groq response format so we don't need to rewrite 100 API routes immediately
        return {
            choices: [
                {
                    message: {
                        content: textResponse
                    }
                }
            ]
        };
    } catch (error: any) {
        console.error("AWS Bedrock Error:", error);
        throw error;
    }
}

/**
 * Native Groq Client completion function.
 * Use this for high speed parsing without AWS rate limit constraints.
 */
export async function analyzeWithGroqLPU(
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    options: any = {}
) {
    const requestedModel = options.model || "llama-3.1-8b-instant";
    try {
        const response = await groq.chat.completions.create({
            messages: messages as any,
            model: requestedModel,
            temperature: options.temperature ?? 0.3,
            max_tokens: options.max_tokens ?? 4096,
            response_format: options.response_format,
        });

        return {
            choices: [
                {
                    message: {
                        content: response.choices[0]?.message?.content || ""
                    }
                }
            ]
        };
    } catch (error: any) {
        console.warn(`Groq API error with model ${requestedModel}: ${error?.message || error}. Trying fallback model llama-3.1-8b-instant...`);
        try {
            const fallbackResponse = await groq.chat.completions.create({
                messages: messages as any,
                model: "llama-3.1-8b-instant",
                temperature: options.temperature ?? 0.3,
                max_tokens: options.max_tokens ?? 4096,
                response_format: options.response_format,
            });

            return {
                choices: [
                    {
                        message: {
                            content: fallbackResponse.choices[0]?.message?.content || ""
                        }
                    }
                ]
            };
        } catch (fallbackError: any) {
            console.warn(`Groq API fallback error: ${fallbackError?.message || fallbackError}. Falling back to AWS Bedrock...`);
            const bedrockText = await generateGroqCompletion(messages, {
                ...options,
                model: "amazon.nova-lite-v1:0"
            });
            return {
                choices: [
                    {
                        message: {
                            content: bedrockText
                        }
                    }
                ]
            };
        }
    }
}

