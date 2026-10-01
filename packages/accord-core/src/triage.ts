/** Zero-cost prefilter for autonomous triage. Owner: Agent 1.
 * Recall-oriented: it only has to discard the obvious majority of channel chatter so the triage
 * model is called rarely. Precision comes from the model and the confidence floor.
 */

const RETENTION_SIGNAL = new RegExp([
  String.raw`\b(?:retain|retained|retaining|retention|purg(?:e|ed|es|ing)|delet(?:e|ed|es|ing|ion)|erase|erasure`,
  String.raw`|clean ?up|archiv(?:e|ed|ing)|expir(?:e|es|ed|y|ation)|ttl|gdpr|lifecycle`,
  String.raw`|keep(?:ing)?\b.{0,40}\b(?:data|records?|logs?|accounts?|backups?|events?|rows?|files?)`,
  String.raw`|\d+\s*(?:days?|weeks?|months?|years?|d|mo|yrs?))\b`,
].join(''), 'i');

/** A question about the current state is not a proposal. */
const QUESTION_ONLY = /^(?:@\S+\s+|<@[^>]+>\s*)*(?:where|what|what's|how|which|who|why|when|show|list|explain|find|summari[sz]e|describe|can you (?:show|explain|find|tell))\b/i;

/** Longest message worth triaging. Larger pastes (logs, documents) are not decisions. */
const MAX_TRIAGE_TEXT = 4_000;

export function mayProposeRetentionPolicy(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 8 || trimmed.length > MAX_TRIAGE_TEXT) return false;
  return RETENTION_SIGNAL.test(trimmed) && !QUESTION_ONLY.test(trimmed);
}
