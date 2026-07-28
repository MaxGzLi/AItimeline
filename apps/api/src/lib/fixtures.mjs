// @ts-check

import { sanitizeSlug } from "../domains/shared.mjs";

export function fixtureSubscriptionFeedXml(variant) {
  const safeVariant = sanitizeSlug(variant);

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>AITimeline Subscription Fixture ${safeVariant}</title>
    <link>https://fixtures.local/subscription/${safeVariant}</link>
    <description>Local subscription fixture for RSS polling smoke checks.</description>
    <item>
      <title><![CDATA[RAG retrieval architecture ${safeVariant} 4]]></title>
      <link>https://fixtures.local/subscription/${safeVariant}/rag-4</link>
      <pubDate>Tue, 07 Jul 2026 04:00:00 GMT</pubDate>
      <description><![CDATA[<p>RAG retrieval architecture and grounded evaluation notes.</p>]]></description>
    </item>
    <item>
      <title>RAG retrieval architecture ${safeVariant} 3</title>
      <link>https://fixtures.local/subscription/${safeVariant}/rag-3</link>
      <pubDate>Tue, 07 Jul 2026 03:00:00 GMT</pubDate>
      <description>RAG retrieval quality improves with grounded evaluation.</description>
    </item>
    <item>
      <title>RAG retrieval architecture ${safeVariant} 2</title>
      <link>https://fixtures.local/subscription/${safeVariant}/rag-2</link>
      <pubDate>Tue, 07 Jul 2026 02:00:00 GMT</pubDate>
      <description>RAG system design and indexing trade-offs.</description>
    </item>
    <item>
      <title>RAG retrieval architecture ${safeVariant} 1</title>
      <link>https://fixtures.local/subscription/${safeVariant}/rag-1</link>
      <pubDate>Tue, 07 Jul 2026 01:00:00 GMT</pubDate>
      <description>RAG notes beyond the single-source import cap.</description>
    </item>
    <item>
      <title>Gardening calendar ${safeVariant}</title>
      <link>https://fixtures.local/subscription/${safeVariant}/garden</link>
      <pubDate>Tue, 07 Jul 2026 00:00:00 GMT</pubDate>
      <description>Tomato watering schedule with no relevant AI concepts.</description>
    </item>
  </channel>
</rss>`;
}

export function fixtureArticleHtml(title) {
  return `
    <html>
      <head>
        <meta property="og:title" content="${title}" />
        <meta name="author" content="AITimeline API Smoke" />
        <meta property="article:published_time" content="2026-06-10T00:00:00.000Z" />
      </head>
      <body>
        <article>
          <p>${title} describes how an AI Agent can turn source material into durable knowledge when it keeps citations, extracts concepts, and creates a learning surface that users can revisit.</p>
          <p>For ${title}, the Knowledge Graph keeps Memory useful because saved concepts, weak concepts, and Recommendation signals point the user toward review at the right time.</p>
          <p>In the ${title} smoke architecture, each imported paragraph becomes a registered chunk, every generated card must cite a chunk id, and the evidence ledger rejects unsupported numeric claims before the card reaches the timeline.</p>
          <p>The ${title} background worker uses interaction signals to choose between three actions: import a matching source, discover a new source, or create a same-source follow-up when no better source is available.</p>
          <p>The operational trade-off in ${title} is budget control. A daily counter caps automatic discover, import, and follow-up jobs so passive reading cannot create an unbounded queue of model and search calls.</p>
        </article>
      </body>
    </html>
  `;
}
