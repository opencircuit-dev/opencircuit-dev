import { Readability } from "@mozilla/readability";
import { fetchUntrustedUrl } from "@opencircuit/fetch";
import { JSDOM } from "jsdom";
import { NodeHtmlMarkdown } from "node-html-markdown";

import { BaseContextProvider } from "../";
import {
  ContextItem,
  ContextProviderDescription,
  ContextProviderExtras,
  RequestOptions,
} from "../../index.js";
import { fetchFavicon } from "../../util/fetchFavicon";

class URLContextProvider extends BaseContextProvider {
  static description: ContextProviderDescription = {
    title: "url",
    displayTitle: "URL",
    description: "Reference a webpage at a given URL",
    type: "query",
  };

  async getContextItems(
    query: string,
    extras: ContextProviderExtras,
  ): Promise<ContextItem[]> {
    return await getUrlContextItems(query, extras.config.requestOptions);
  }
}

export default URLContextProvider;

export async function getUrlContextItems(
  query: string,
  requestOptions?: RequestOptions,
): Promise<ContextItem[]> {
  const url = new URL(query);
  const resp = await fetchUntrustedUrl(url, {}, requestOptions);

  // Check if the response is not OK
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  }
  const html = await resp.text();
  const icon = await fetchFavicon(url, requestOptions);

  const dom = new JSDOM(html);
  let reader = new Readability(dom.window.document);
  let article = reader.parse();
  const content = article?.content || "";
  const markdown = NodeHtmlMarkdown.translate(
    content,
    {},
    undefined,
    undefined,
  );

  const title = article?.title || url.pathname;

  return [
    {
      icon,
      description: url.toString(),
      content: markdown,
      name: title,
      uri: {
        type: "url",
        value: url.toString(),
      },
    },
  ];
}
