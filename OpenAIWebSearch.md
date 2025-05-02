When using Chat Completions, the model always retrieves information from the web before responding to your query. To use web_search_preview as a tool that models like gpt-4o and gpt-4o-mini invoke only when necessary, switch to using the Responses API.

Currently, you need to use one of these models to use web search in Chat Completions:

gpt-4o-search-preview
gpt-4o-mini-search-preview

--------------------------------

Web search parameter example:

import OpenAI from "openai";
const client = new OpenAI();

const completion = await client.chat.completions.create({
    model: "gpt-4o-search-preview",
    web_search_options: {},
    messages: [{
        "role": "user",
        "content": "What was a positive news story from today?"
    }],
});

console.log(completion.choices[0].message.content);

---------------------------------

The API response item in the choices array will include:

message.content with the text result from the model, inclusive of any inline citations
annotations with a list of cited URLs
By default, the model's response will include inline citations for URLs found in the web search results. In addition to this, the url_citation annotation object will contain the URL and title of the cited source, as well as the start and end index characters in the model's response where those sources were used.

[
  {
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "the model response is here...",
      "refusal": null,
      "annotations": [
        {
          "type": "url_citation",
          "url_citation": {
            "end_index": 985,
            "start_index": 764,
            "title": "Page title...",
            "url": "https://..."
          }
        }
      ]
    },
    "finish_reason": "stop"
  }
]

----------------------------------

When using this tool, the search_context_size parameter controls how much context is retrieved from the web to help the tool formulate a response. The tokens used by the search tool do not affect the context window of the main model specified in the model parameter in your response creation request. These tokens are also not carried over from one turn to another — they're simply used to formulate the tool response and then discarded.

Choosing a context size impacts:

Cost: Pricing of our search tool varies based on the value of this parameter. Higher context sizes are more expensive. See tool pricing here.
Quality: Higher search context sizes generally provide richer context, resulting in more accurate, comprehensive answers.
Latency: Higher context sizes require processing more tokens, which can slow down the tool's response time.
Available values:

high: Most comprehensive context, highest cost, slower response.
medium (default): Balanced context, cost, and latency.
low: Least context, lowest cost, fastest response, but potentially lower answer quality.

Customizing search context size:

import OpenAI from "openai";
const client = new OpenAI();

const completion = await client.chat.completions.create({
    model: "gpt-4o-search-preview",
    web_search_options: {
        search_context_size: "low",
    },
    messages: [{
        "role": "user",
        "content": "What movie won best picture in 2025?",
    }],
});
console.log(completion.choices[0].message.content);