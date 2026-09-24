export const openAiFixtures = {
  streamChat: [
    { choices: [{ delta: { content: "Hello" } }] },
    { choices: [{ delta: { content: " from OpenAI" } }] },
  ],
  toolCall: [
    {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                id: "call_fixture_123",
                type: "function",
                function: {
                  name: "say_hello",
                  arguments: '{"name":"Nate"}',
                },
              },
            ],
          },
        },
      ],
    },
  ],
  o1Response: {
    choices: [
      {
        message: {
          role: "assistant",
          content: "Hello from o1",
        },
      },
    ],
  },
};
