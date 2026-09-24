export const anthropicFixtures = {
  streamChat: [
    {
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Hello" },
    },
    {
      type: "content_block_delta",
      delta: { type: "text_delta", text: " from Anthropic" },
    },
    { type: "content_block_stop" },
  ],
  toolCall: [
    {
      type: "content_block_start",
      content_block: {
        type: "tool_use",
        id: "toolu_fixture_123",
        name: "say_hello",
      },
    },
    {
      type: "content_block_delta",
      delta: {
        type: "input_json_delta",
        partial_json: '{"name":"Nate"}',
      },
    },
    { type: "content_block_stop" },
  ],
};
