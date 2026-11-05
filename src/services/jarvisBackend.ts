export interface JarvisResponse {
  output: string;
  raw?: unknown;
}

export async function sendJarvisCommand(query: string, sessionId = "jarvis-web"): Promise<string> {
  const endpoint = "https://n8n.wolfcubventures.com/webhook/jarvis-command";
  
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        query: query.trim(),
        sessionId,
      }),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const text = await res.text();
    try {
      const data = JSON.parse(text);
      if (typeof data === "string") return data;
      if (data && typeof data === "object") {
        if ("output" in data && typeof data.output === "string") return data.output;
        if ("response" in data && typeof data.response === "string") return data.response;
        if ("message" in data && typeof data.message === "string") return data.message;
        if ("text" in data && typeof data.text === "string") return data.text;
      }
      return text;
    } catch {
      return text;
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[Jarvis Backend Error]", errorMsg);
    throw new Error(`Command link failed: ${errorMsg}`);
  }
}
