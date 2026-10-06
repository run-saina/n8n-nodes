export interface AskResponse { model: string; answers: Record<string, {type: string; reason?: string; [key: string]: unknown}>; usage: {input_tokens: number; output_tokens: number}; }
export function parseQuestions(value: unknown): Record<string, {type: string; options?: Record<string, unknown>; levels?: unknown[]}> {
  const questions = typeof value === 'string' ? JSON.parse(value) : value;
  if (!questions || typeof questions !== 'object' || Array.isArray(questions) || Object.keys(questions).length < 1 || Object.keys(questions).length > 256 || Object.values(questions).some((q: unknown) => !q || typeof q !== 'object' || !('type' in q) || typeof q.type !== 'string' || !['yes_no', 'single_choice', 'rating', 'multi_choice'].includes(q.type))) throw new Error('Provide 1–256 typed questions as a JSON object');
  return questions;
}
export function readResponse(raw: unknown, questions: Record<string, {type: string; options?: Record<string, unknown>; levels?: unknown[]}>, mode: string): AskResponse {
  const data = raw as AskResponse;
  if (!data || typeof data.model !== 'string' || !data.answers || Object.keys(data.answers).length !== Object.keys(questions).length) throw new Error('Invalid answer response');
  for (const [id, q] of Object.entries(questions)) {
    const answer = Object.prototype.hasOwnProperty.call(data.answers, id) && data.answers[id];
    if (!answer || answer.type !== q.type || (mode === 'decision' && !['accepted', 'below_threshold', 'below_margin', 'tie'].includes(answer.reason || ''))) throw new Error('Invalid typed answer');
    const vector = q.type === 'yes_no' ? {yes: answer.yes, no: answer.no} : q.type === 'multi_choice' ? answer.memberships : answer.probabilities;
    if (!vector || typeof vector !== 'object' || Array.isArray(vector)) throw new Error('Missing probabilities');
    const labels = q.type === 'yes_no' ? ['yes','no'] : q.type === 'rating' ? (q.levels || []).map((_,i) => String(i)) : Object.keys(q.options || {});
    if (Object.keys(vector).length !== labels.length || !labels.every(key => Object.prototype.hasOwnProperty.call(vector, key))) throw new Error('Mismatched option keys');
    const values = Object.values(vector) as number[];
    if (values.length < 2 || values.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) || (q.type !== 'multi_choice' && Math.abs(values.reduce((a,b) => a+b,0)-1) > 1e-5)) throw new Error('Invalid probabilities');
    if (mode === 'decision') {
      const accepted = answer.reason === 'accepted';
      if (q.type === 'single_choice' && (accepted ? typeof answer.selection !== 'string' || !labels.includes(answer.selection) : answer.selection !== null)) throw new Error('Invalid selection');
      if (q.type === 'yes_no' && (accepted ? typeof answer.selected !== 'boolean' : answer.selected !== null)) throw new Error('Invalid binary decision');
      if (q.type === 'rating' && (accepted ? typeof answer.level !== 'number' || !Number.isInteger(answer.level) || answer.level < 0 || answer.level >= labels.length : answer.level !== null)) throw new Error('Invalid rating decision');
      if (q.type === 'multi_choice' && (!Array.isArray(answer.selections) || !answer.selections.every(k => typeof k === 'string' && labels.includes(k)) || new Set(answer.selections).size !== answer.selections.length || accepted !== (answer.selections.length > 0))) throw new Error('Invalid tag selections');
    }
  }
  return data;
}
