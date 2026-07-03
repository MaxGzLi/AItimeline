import type { KnowledgeCard } from "@aitimeline/core";
import { parseWikilinks, resolveWikilink } from "@aitimeline/core";
import type { ReactNode } from "react";

export interface WikilinkHandlers {
  onOpenConcept: (concept: string) => void;
  onOpenCardId: (cardId: string) => void;
}

/**
 * Render text with `[[wikilinks]]` as inline links: concept and card links are
 * clickable, ghost links are dimmed and inert. Links are spans (not buttons) so
 * they stay valid nested inside a post's open button, and plain text is kept as
 * raw string nodes so the surrounding `white-space: pre-line` still shows note
 * line breaks. Returns the original string untouched when there are no links.
 */
export function renderWithWikilinks(
  text: string,
  cards: KnowledgeCard[],
  handlers: WikilinkHandlers
): ReactNode {
  const links = parseWikilinks(text);

  if (links.length === 0) {
    return text;
  }

  const nodes: ReactNode[] = [];
  let cursor = 0;

  links.forEach((link, index) => {
    if (link.start > cursor) {
      nodes.push(text.slice(cursor, link.start));
    }

    const resolved = resolveWikilink(link.target, { cards });
    const key = `wl-${index}`;

    if (resolved.kind === "ghost") {
      nodes.push(
        <span className="x-wikilink ghost" key={key} title="还没有这条内容">
          {resolved.label}
        </span>
      );
    } else {
      const open = () =>
        resolved.kind === "concept"
          ? handlers.onOpenConcept(resolved.label)
          : handlers.onOpenCardId(resolved.targetId);

      nodes.push(
        <span
          className={`x-wikilink ${resolved.kind}`}
          key={key}
          onClick={(event) => {
            event.stopPropagation();
            open();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              open();
            }
          }}
          role="link"
          tabIndex={0}
        >
          {resolved.label}
        </span>
      );
    }

    cursor = link.end;
  });

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes;
}
