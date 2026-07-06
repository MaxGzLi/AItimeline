import { LoaderCircle } from "lucide-react";
import { forwardRef, type FormEvent } from "react";
import { t } from "../lib/i18n";
import { WikilinkInput, type WikilinkAutocompleteCandidate } from "./WikilinkAutocomplete";

export const AskComposer = forwardRef<
  HTMLInputElement,
  {
    mode: "question" | "idea";
    isAsking: boolean;
    onModeChange: (mode: "question" | "idea") => void;
    onQuestionChange: (value: string) => void;
    onSubmit: (event: FormEvent<HTMLFormElement>) => void;
    question: string;
    wikilinkCandidates: WikilinkAutocompleteCandidate[];
  }
>(function AskComposer({ mode, isAsking, onModeChange, onQuestionChange, onSubmit, question, wikilinkCandidates }, inputRef) {
  const sampleQuestions = [t("ask.sample1"), t("ask.sample2")];

  return (
    <form className="x-composer" onSubmit={onSubmit}>
      <span className="x-avatar" aria-hidden="true">
        {t("common.you")}
      </span>
      <div className="x-composer-main">
        <WikilinkInput
          aria-label={t("ask.prompt")}
          candidates={wikilinkCandidates}
          onValueChange={onQuestionChange}
          placeholder={mode === "idea" ? t("ask.placeholder.idea") : t("ask.placeholder.question")}
          ref={inputRef}
          value={question}
        />
        <div className="x-composer-foot">
          <div className="x-modechips" aria-label={t("ask.modeLabel")} role="group">
            <button
              aria-pressed={mode === "question"}
              className={`x-chip action${mode === "question" ? " active" : ""}`}
              onClick={() => onModeChange("question")}
              type="button"
            >
              {t("ask.mode.question")}
            </button>
            <button
              aria-pressed={mode === "idea"}
              className={`x-chip action${mode === "idea" ? " active" : ""}`}
              onClick={() => onModeChange("idea")}
              type="button"
            >
              {t("ask.mode.idea")}
            </button>
          </div>
          {sampleQuestions.map((sample) => (
            <button className="x-hint" key={sample} onClick={() => onQuestionChange(sample)} type="button">
              {sample}
            </button>
          ))}
          <button className="x-pill" disabled={isAsking || !question.trim()} type="submit">
            {isAsking ? <LoaderCircle className="x-spin" size={16} /> : null}
            {isAsking ? t("ask.thinking") : mode === "idea" ? t("ask.postIdea") : t("ask.postQuestion")}
          </button>
        </div>
      </div>
    </form>
  );
});
