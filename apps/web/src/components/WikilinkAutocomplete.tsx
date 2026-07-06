import type { KnowledgeCard } from "@aitimeline/core";
import {
  forwardRef,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
  type Ref
} from "react";
import { slugConcept } from "../lib/format";
import { t } from "../lib/i18n";

export type WikilinkAutocompleteCandidateKind = "concept" | "card";

export interface WikilinkAutocompleteCandidate {
  kind: WikilinkAutocompleteCandidateKind;
  label: string;
}

interface ActiveWikilink {
  query: string;
  start: number;
}

const MAX_WIKILINK_SUGGESTIONS = 8;

export function buildWikilinkAutocompleteCandidates(cards: KnowledgeCard[]): WikilinkAutocompleteCandidate[] {
  const candidates: WikilinkAutocompleteCandidate[] = [];
  const seenConcepts = new Set<string>();
  const seenLabels = new Set<string>();

  for (const card of cards) {
    for (const concept of card.concepts) {
      const key = slugConcept(concept);

      if (!key || seenConcepts.has(key)) {
        continue;
      }

      seenConcepts.add(key);
      seenLabels.add(concept.toLowerCase());
      candidates.push({ kind: "concept", label: concept });
    }
  }

  for (const card of cards) {
    const labelKey = card.title.toLowerCase();

    if (!card.title.trim() || seenLabels.has(labelKey)) {
      continue;
    }

    seenLabels.add(labelKey);
    candidates.push({ kind: "card", label: card.title });
  }

  return candidates;
}

export interface WikilinkInputProps extends Omit<ComponentPropsWithoutRef<"input">, "onChange" | "value"> {
  candidates: WikilinkAutocompleteCandidate[];
  onValueChange: (value: string) => void;
  value: string;
}

export const WikilinkInput = forwardRef<HTMLInputElement, WikilinkInputProps>(function WikilinkInput(
  { candidates, disabled, onBlur, onFocus, onKeyDown, onMouseUp, onSelect, onValueChange, value, ...inputProps },
  forwardedRef
) {
  const internalRef = useRef<HTMLInputElement | null>(null);
  const menuId = useId();
  const [cursor, setCursor] = useState(0);
  const [focused, setFocused] = useState(false);
  const [dismissedQuery, setDismissedQuery] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const activeWikilink = focused && !disabled ? findActiveWikilink(value, cursor) : null;
  const suggestions = useMemo(
    () => filterWikilinkCandidates(candidates, activeWikilink?.query ?? ""),
    [activeWikilink?.query, candidates]
  );
  const isOpen =
    !!activeWikilink &&
    suggestions.length > 0 &&
    dismissedQuery !== `${activeWikilink.start}:${activeWikilink.query}`;

  useEffect(() => {
    setHighlightedIndex(0);
  }, [activeWikilink?.query, activeWikilink?.start]);

  useEffect(() => {
    if (highlightedIndex >= suggestions.length) {
      setHighlightedIndex(Math.max(0, suggestions.length - 1));
    }
  }, [highlightedIndex, suggestions.length]);

  function setInputRef(node: HTMLInputElement | null) {
    internalRef.current = node;
    setForwardedRef(forwardedRef, node);
  }

  function syncCursor() {
    const input = internalRef.current;
    setCursor(input?.selectionStart ?? value.length);
  }

  function applySuggestion(candidate: WikilinkAutocompleteCandidate) {
    if (!activeWikilink) {
      return;
    }

    const nextValue = `${value.slice(0, activeWikilink.start)}[[${candidate.label}]]${value.slice(cursor)}`;
    const nextCursor = activeWikilink.start + candidate.label.length + 4;

    onValueChange(nextValue);
    setDismissedQuery(null);
    setCursor(nextCursor);
    requestAnimationFrame(() => {
      const input = internalRef.current;
      input?.focus();
      input?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    onKeyDown?.(event);

    if (event.defaultPrevented || !isOpen || event.nativeEvent.isComposing) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((index) => (index + 1) % suggestions.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      applySuggestion(suggestions[highlightedIndex] ?? suggestions[0]);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (activeWikilink) {
        setDismissedQuery(`${activeWikilink.start}:${activeWikilink.query}`);
      }
    }
  }

  return (
    <span className="x-wikilink-field">
      <input
        {...inputProps}
        aria-autocomplete="list"
        aria-controls={isOpen ? menuId : undefined}
        aria-expanded={isOpen}
        disabled={disabled}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        onChange={(event) => {
          onValueChange(event.target.value);
          setDismissedQuery(null);
          setCursor(event.target.selectionStart ?? event.target.value.length);
        }}
        onFocus={(event) => {
          setFocused(true);
          syncCursor();
          onFocus?.(event);
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={syncCursor}
        onMouseUp={(event) => {
          syncCursor();
          onMouseUp?.(event);
        }}
        onSelect={(event) => {
          syncCursor();
          onSelect?.(event);
        }}
        ref={setInputRef}
        role="combobox"
        value={value}
      />
      {isOpen ? (
        <span className="x-wikilink-menu" id={menuId} role="listbox">
          {suggestions.map((candidate, index) => (
            <button
              aria-selected={index === highlightedIndex}
              className={`x-wikilink-option${index === highlightedIndex ? " active" : ""}`}
              key={`${candidate.kind}:${candidate.label}`}
              onMouseDown={(event) => {
                event.preventDefault();
                applySuggestion(candidate);
              }}
              role="option"
              type="button"
            >
              <span className="x-wikilink-option-main">{candidate.label}</span>
              <span className="x-wikilink-option-kind">
                {candidate.kind === "concept" ? t("common.concept") : t("common.card")}
              </span>
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
});

function filterWikilinkCandidates(
  candidates: WikilinkAutocompleteCandidate[],
  query: string
): WikilinkAutocompleteCandidate[] {
  const normalizedQuery = query.trim().toLowerCase();
  const matches = normalizedQuery
    ? candidates.filter((candidate) => candidate.label.toLowerCase().includes(normalizedQuery))
    : candidates;

  return matches.slice(0, MAX_WIKILINK_SUGGESTIONS);
}

function findActiveWikilink(value: string, cursor: number): ActiveWikilink | null {
  const start = value.lastIndexOf("[[", cursor);

  if (start < 0 || start + 2 > cursor) {
    return null;
  }

  const query = value.slice(start + 2, cursor);

  if (/[\[\]]/.test(query)) {
    return null;
  }

  const closing = value.indexOf("]]", start + 2);
  const nextOpening = value.indexOf("[[", start + 2);

  if (closing >= 0 && (nextOpening < 0 || closing < nextOpening)) {
    return null;
  }

  return { query, start };
}

function setForwardedRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) {
    return;
  }

  if (typeof ref === "function") {
    ref(value);
    return;
  }

  ref.current = value;
}
