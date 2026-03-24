import { NextResponse } from "next/server";
import OpenAI from "openai";

const SYSTEM_PROMPT = `You are a professional construction site report writer for AT-PD, a project management firm overseeing data center construction for Nvidia. Polish the following observation note into clear, professional language suitable for an internal construction report. Keep it concise and factual. Use complete sentences. Do not add information that wasn't in the original. Return only the polished text, no preamble.`;

const CONTEXT_HINTS: Record<string, string> = {
  highlight: "This is a site highlight or notable observation.",
  recommendation: "This is a recommendation to a contractor or subcontractor.",
  risk: "This is a risk or opportunity observation.",
  escalation: "This is an escalation item requiring management attention.",
};

export async function POST(req: Request) {
  try {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 503 });
    }

    const { text, context } = await req.json() as { text: string; context?: string };
    if (!text || text.trim().length < 10) {
      return NextResponse.json({ error: "text too short" }, { status: 400 });
    }

    const contextHint = context ? (CONTEXT_HINTS[context] ?? "") : "";
    const userPrompt = contextHint
      ? `${contextHint}\n\n${text.trim()}`
      : text.trim();

    const client = new OpenAI({ apiKey: openaiKey });
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 300,
      temperature: 0.3,
    });

    const polished = response.choices[0]?.message?.content?.trim() ?? text;
    return NextResponse.json({ polished });
  } catch (e: unknown) {
    const err = e as Error;
    console.error("ai-polish error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
