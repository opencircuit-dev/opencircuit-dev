export const mistralFixtures = {
  streamChat: [
    { choices: [{ delta: { content: "Hello" } }] },
    { choices: [{ delta: { content: " from Mistral" } }] },
  ],
  streamFim: [
    { choices: [{ delta: { content: "my " } }] },
    { choices: [{ delta: { content: "friend" } }] },
  ],
  toolCall: [
    {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                id: "call_fixture_789",
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
};
