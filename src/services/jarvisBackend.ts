export interface JarvisResponse {
  output: string;
  raw?: unknown;
}

export interface JarvisCommandPayload {
  query: string;
  sessionId?: string;
  speaker?: string;
  speakerConfidence?: number;
  isAuthorizedOwner?: boolean;
}

export async function sendJarvisCommand(
  payloadOrQuery: string | JarvisCommandPayload,
  defaultSessionId = "jarvis-web"
): Promise<string> {
  const endpoint = "https://n8n.wolfcubventures.com/webhook/jarvis-command";
  
  let bodyPayload: Record<string, unknown>;
  if (typeof payloadOrQuery === "string") {
    bodyPayload = {
      query: payloadOrQuery.trim(),
      sessionId: defaultSessionId,
      speaker: "Owner",
      speakerConfidence: 1.0,
      isAuthorizedOwner: true,
    };
  } else {
    bodyPayload = {
      query: payloadOrQuery.query.trim(),
      sessionId: payloadOrQuery.sessionId || defaultSessionId,
      speaker: payloadOrQuery.speaker || "Unknown",
      speakerConfidence: payloadOrQuery.speakerConfidence ?? 0.85,
      isAuthorizedOwner: payloadOrQuery.isAuthorizedOwner ?? true,
    };
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(bodyPayload),
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
