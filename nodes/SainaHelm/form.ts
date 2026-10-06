export interface AdvancedOptions {
  answerType?: string;
  resultKey?: string;
  descriptions?: { entries?: Array<{ answer: string; description: string }> };
  mode?: string;
  threshold?: number;
  minMargin?: number;
  timeout?: number;
  errorMode?: string;
}

export function buildQuestion(question: string, answers: string, advanced: AdvancedOptions = {}) {
  if (typeof question !== 'string' || !question.trim()) throw new Error('Question is required');
  if (typeof answers !== 'string' || !answers.trim()) throw new Error('Provide at least two answers');
  // Newlines allow labels containing commas; a single line also accepts comma-separated labels.
  const labels = answers.trim().split(/\r?\n/.test(answers.trim()) ? /\r?\n/ : ',').map(label => label.trim());
  if (labels.length < 2 || labels.length > 255 || labels.some(label => !label)) throw new Error('Provide 2–255 non-empty answers');
  if (new Set(labels.map(label => label.toLowerCase())).size !== labels.length) throw new Error('Answer labels must be unique');
  const descriptions = new Map<string, string>();
  for (const entry of advanced.descriptions?.entries ?? []) {
    if (!labels.includes(entry.answer) || descriptions.has(entry.answer)) throw new Error('Each description must match one unique answer label');
    if (typeof entry.description !== 'string' || !entry.description.trim()) throw new Error('Remove empty descriptions or provide a description');
    descriptions.set(entry.answer, entry.description.trim());
  }
  const type = advanced.answerType ?? 'single_choice';
  const common = { type, question: question.trim() };
  let value;
  if (type === 'yes_no') {
    if (labels.length !== 2 || !labels.some(label => label.toLowerCase() === 'yes') || !labels.some(label => label.toLowerCase() === 'no')) throw new Error('Yes / No requires exactly the answers Yes and No');
    const descriptionFor = (label: string) => {
      const original = labels.find(value => value.toLowerCase() === label)!;
      return descriptions.get(original) ?? original;
    };
    value = { ...common, descriptions: { yes: descriptionFor('yes'), no: descriptionFor('no') } };
  } else if (type === 'rating') {
    if (labels.length > 10) throw new Error('Rating requires 2–10 answers ordered from lowest to highest');
    value = { ...common, levels: labels.map(label => descriptions.has(label) ? `${label}: ${descriptions.get(label)}` : label) };
  } else if (type === 'single_choice' || type === 'multi_choice') {
    value = { ...common, options: Object.fromEntries(labels.map(label => [label, descriptions.get(label) ?? null])) };
  } else throw new Error('Select a supported answer type');
  const key = advanced.resultKey ?? 'answer';
  if (typeof key !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) throw new Error('Result key must start with a letter and contain only letters, numbers, or underscores');
  return { [key]: value };
}

export function readAdvanced(advanced: AdvancedOptions) {
  const mode = advanced.mode ?? 'decision';
  const errorMode = advanced.errorMode ?? 'stop';
  const threshold = advanced.threshold ?? 0.8;
  const minMargin = advanced.minMargin ?? 0;
  const timeout = advanced.timeout ?? 60;
  if (!['decision', 'distribution'].includes(mode)) throw new Error('Select a supported mode');
  if (!['stop', 'fallback'].includes(errorMode)) throw new Error('Select a supported error action');
  for (const value of [threshold, minMargin]) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error('Confidence threshold and margin must be between 0 and 1');
  }
  if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout < 1 || timeout > 300) throw new Error('Timeout must be between 1 and 300 seconds');
  return { mode, errorMode, threshold, minMargin, timeout };
}
