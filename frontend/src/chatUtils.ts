/** Model outputs this between two parts; UI splits into two assistant bubbles. */
export const ASSISTANT_MESSAGE_SPLIT = "\n---\n";

/** If streamed chunks join a sentence end directly to the next capital letter, insert a space. */
export function fixMissingSpaceAfterSentenceEnd(text: string): string {
  return text.replace(/([.!?])([A-Z])/g, "$1 $2");
}

/** Chat UI does not render Markdown; strip ** so it does not show literally. */
export function stripMarkdownBoldMarkers(text: string): string {
  return text.replace(/\*\*/g, "");
}

export function splitAssistantReply(
  full: string,
): { first: string; second: string } | null {
  const idx = full.indexOf(ASSISTANT_MESSAGE_SPLIT);
  if (idx === -1) return null;
  const first = full.slice(0, idx).trim();
  const second = full.slice(idx + ASSISTANT_MESSAGE_SPLIT.length).trim();
  if (!first || !second) return null;
  return { first, second };
}

export async function parseNdjsonStream(
  body: ReadableStream<Uint8Array>,
  onChunk: (text: string) => void,
): Promise<{ error?: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let err: string | undefined;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as {
          chunk?: string;
          done?: boolean;
          error?: string;
        };
        if (obj.error) err = obj.error;
        if (obj.chunk) onChunk(obj.chunk);
      } catch {
        err = "Invalid response from server.";
      }
    }
  }
  if (buffer.trim()) {
    try {
      const obj = JSON.parse(buffer) as { chunk?: string; error?: string };
      if (obj.error) err = obj.error;
      if (obj.chunk) onChunk(obj.chunk);
    } catch {
      /* ignore trailing partial */
    }
  }
  return { error: err };
}
