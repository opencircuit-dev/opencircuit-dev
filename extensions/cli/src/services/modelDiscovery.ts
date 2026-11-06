function discoverableOpenAIModels(ids: string[]): string[] {
  // The catalog has no capability metadata; exclude unknown and specialized APIs.
  const chatModel =
    /^(gpt-(?:3\.5-turbo(?:-16k)?|4(?:-turbo|-32k)?|4o(?:-mini)?|4\.1(?:-mini|-nano)?|5(?:\.\d+)?(?:-mini|-nano)?(?:-chat-latest)?)|o[134](?:-mini)?)(?:-(?:\d{4}-\d{2}-\d{2}|\d{4}))?$/;
  const available = new Set(ids.filter((id) => typeof id === "string"));
  return [...available]
    .filter((id) => {
      const match = id.match(chatModel);
      if (!match) return false;
      if (id !== match[1] && available.has(match[1])) return false;
      return (
        !id.endsWith("-chat-latest") ||
        !available.has(id.replace(/-chat-latest$/, ""))
      );
    })
    .sort();
}

export const discoveryProviders = new Set([
  "openai",
  "anthropic",
  "gemini",
  "openai-compatible",
]);
const claudeChatModel =
  /^claude-(?:(?:\d+(?:-\d+)*-)?(?:sonnet|haiku|opus)(?:-[a-z0-9]+)*|(?:instant-)?\d+(?:\.\d+)?(?:-\d{8})?)$/;
const geminiChatModel =
  /^gemini-\d+(?:\.\d+)?-(?:pro|flash(?:-lite|-8b)?)(?:-(?:latest|\d{3}|preview|exp)(?:-\d{2}-\d{2}|\d{4})?)?$/;

function compatibleChatModel(model: { id: string }): boolean {
  const id = model.id;
  if (
    typeof id !== "string" ||
    /embed|rerank|whisper|transcrib|speech|tts|diffusion|image|guard|moderation|reward|(?:^|[/:-])flux(?:$|[/:.-])/i.test(
      id,
    )
  ) {
    return false;
  }
  if ("capabilities" in model) {
    const capabilities = model.capabilities;
    const chat = ["chat", "chat_completion", "chat_completions", "completion"];
    if (Array.isArray(capabilities)) {
      return capabilities.some((capability) => chat.includes(capability));
    }
    if (capabilities && typeof capabilities === "object") {
      return Object.entries(capabilities).some(
        ([capability, enabled]) =>
          chat.includes(capability) && enabled === true,
      );
    }
    return false;
  }
  // Compatible catalogs commonly omit capabilities; only infer known chat families.
  return (
    discoverableOpenAIModels([id]).length > 0 ||
    claudeChatModel.test(id) ||
    geminiChatModel.test(id) ||
    /(?:^|\/)(?:olmo\d*|muse-spark|llama(?:\d|[-_.])|qwen(?:\d|[-_.])|deepseek|mistral|mixtral|gemma(?:\d|[-_.])|phi[-\d]|command-[ra])[\w.:/-]*$/i.test(
      id,
    ) ||
    /(?:^|[-_/])(?:chat|instruct)(?:$|[-_.:])/i.test(id)
  );
}

export function discoverableChatModels(
  provider: string,
  catalog: { id: string }[],
): string[] {
  if (provider === "openai") {
    return discoverableOpenAIModels(catalog.map((model) => model?.id));
  }
  return [
    ...new Set(
      catalog
        .filter((model) => {
          if (typeof model?.id !== "string") return false;
          if (provider === "anthropic") return claudeChatModel.test(model.id);
          if (provider === "gemini") return geminiChatModel.test(model.id);
          return provider === "openai-compatible" && compatibleChatModel(model);
        })
        .map((model) => model.id),
    ),
  ].sort();
}
