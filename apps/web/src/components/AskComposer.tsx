import { LoaderCircle } from "lucide-react";
import { forwardRef, type FormEvent } from "react";
import { WikilinkInput, type WikilinkAutocompleteCandidate } from "./WikilinkAutocomplete";

const sampleQuestions = ["RAG 和微调该怎么选？", "什么是知识边界？"];

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
  return (
    <form className="x-composer" onSubmit={onSubmit}>
      <span className="x-avatar" aria-hidden="true">
        你
      </span>
      <div className="x-composer-main">
        <WikilinkInput
          aria-label="问知识库"
          candidates={wikilinkCandidates}
          onValueChange={onQuestionChange}
          placeholder="问你的知识库，或记一条想法…"
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
            {isAsking ? "思考中" : "发布"}
          </button>
        </div>
      </div>
    </form>
  );
});
