import { LoaderCircle } from "lucide-react";
import { forwardRef, type FormEvent } from "react";
import { t } from "../lib/i18n";
import { WikilinkInput, type WikilinkAutocompleteCandidate } from "./WikilinkAutocomplete";

export const AskComposer = forwardRef<
  HTMLInputElement,
  {
    isAsking: boolean;
    onQuestionChange: (value: string) => void;
    onSubmit: (event: FormEvent<HTMLFormElement>) => void;
    question: string;
    wikilinkCandidates: WikilinkAutocompleteCandidate[];
  }
>(function AskComposer({ isAsking, onQuestionChange, onSubmit, question, wikilinkCandidates }, inputRef) {
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
          placeholder={t("ask.placeholder")}
          ref={inputRef}
          value={question}
        />
        <div className="x-composer-foot">
          {sampleQuestions.map((sample) => (
            <button className="x-hint" key={sample} onClick={() => onQuestionChange(sample)} type="button">
              {sample}
            </button>
          ))}
          <button className="x-pill" disabled={isAsking || !question.trim()} type="submit">
            {isAsking ? <LoaderCircle className="x-spin" size={16} /> : null}
            {isAsking ? t("ask.thinking") : t("ask.post")}
          </button>
        </div>
      </div>
    </form>
  );
});
