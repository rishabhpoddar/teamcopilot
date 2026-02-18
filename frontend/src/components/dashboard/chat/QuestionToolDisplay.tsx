import { useState } from 'react';
import type { ToolPart } from '../../../types/chat';

interface QuestionOption {
    label: string;
    description: string;
}

interface Question {
    question: string;
    header: string;
    options: QuestionOption[];
}

interface QuestionToolDisplayProps {
    part: ToolPart;
    onAnswer: (answer: string) => void;
}

export default function QuestionToolDisplay({ part, onAnswer }: QuestionToolDisplayProps) {
    const [customInput, setCustomInput] = useState('');
    const [selectedOptions, setSelectedOptions] = useState<Record<number, number>>({});

    const isWaiting = part.state.status === 'running' || part.state.status === 'pending';

    // Parse the questions from the tool input
    const questions: Question[] = part.state.input?.questions as Question[] || [];

    if (questions.length === 0) {
        return null;
    }

    const handleOptionClick = (optionLabel: string) => {
        if (!isWaiting) return;
        onAnswer(optionLabel);
    };

    const handleCustomSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!isWaiting || !customInput.trim()) return;
        onAnswer(customInput.trim());
        setCustomInput('');
    };

    const getAnswerForQuestion = (questionIndex: number): string | null => {
        if (part.state.status !== 'completed') {
            return null;
        }

        const answers = (part.state.metadata as { answers?: unknown })?.answers;
        if (!Array.isArray(answers) || questionIndex >= answers.length) {
            return null;
        }

        const answerEntry = answers[questionIndex];
        if (typeof answerEntry === 'string') {
            return answerEntry;
        }

        if (Array.isArray(answerEntry)) {
            const firstString = answerEntry.find((item): item is string => typeof item === 'string');
            return firstString ?? null;
        }

        return null;
    };

    const normalize = (value: string): string => value.trim().toLowerCase();

    return (
        <div className="question-tool">
            {questions.map((q, qIndex) => (
                (() => {
                    const answerText = getAnswerForQuestion(qIndex);
                    const matchedOptionIndex = answerText
                        ? q.options.findIndex(option => normalize(option.label) === normalize(answerText))
                        : -1;
                    const selectedOption = isWaiting ? selectedOptions[qIndex] : matchedOptionIndex;

                    return (
                        <div key={qIndex} className="question-block">
                            <div className="question-header">{q.header}</div>
                            <div className="question-text">{q.question}</div>
                            <div className="question-options">
                                {q.options.map((option, oIndex) => (
                                    <button
                                        key={oIndex}
                                        className={`question-option ${selectedOption === oIndex ? 'selected' : ''} ${!isWaiting ? 'disabled' : ''}`}
                                        onClick={() => {
                                            setSelectedOptions(prev => ({ ...prev, [qIndex]: oIndex }));
                                            handleOptionClick(option.label);
                                        }}
                                        disabled={!isWaiting}
                                    >
                                        <span className="option-label">{option.label}</span>
                                        <span className="option-description">{option.description}</span>
                                    </button>
                                ))}
                            </div>
                            {isWaiting && (
                                <form className="question-custom" onSubmit={handleCustomSubmit}>
                                    <input
                                        type="text"
                                        className="question-custom-input"
                                        placeholder="Or type a custom response..."
                                        value={customInput}
                                        onChange={(e) => setCustomInput(e.target.value)}
                                    />
                                    <button
                                        type="submit"
                                        className="question-custom-submit"
                                        disabled={!customInput.trim()}
                                    >
                                        Send
                                    </button>
                                </form>
                            )}
                            {!isWaiting && answerText && (
                                <div className="question-answer-display">
                                    <span className="answer-label">Your answer:</span>
                                    <span className="answer-value">{answerText}</span>
                                </div>
                            )}
                        </div>
                    );
                })()
            ))}
        </div>
    );
}
