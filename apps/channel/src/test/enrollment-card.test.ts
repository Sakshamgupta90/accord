import assert from 'node:assert/strict';
import { test } from 'node:test';
import { looksLikeRetentionDecision } from '../channel.js';

test('the enrollment card is shown for retention decisions and proposals', () => {
  for (const text of [
    'Confirmed: free accounts with verified university status now get 90 days retention for records we already store, effective immediately',
    'Free accounts with verified university status should retain existing records for 90 days, starting now.',
    'Should we maybe give paid company accounts 45 days retention?',
    "Let's keep student data longer.",
    'Update: make it 60 days instead of 90.',
    'We will purge records for personal accounts after 30 days.',
  ]) assert.equal(looksLikeRetentionDecision(text), true, text);
});

test('the enrollment card is not shown for code, GitHub and status questions', () => {
  for (const text of [
    'Show the last 5 commits.',
    'What issues are open?',
    'Who last changed the authorization code?',
    'Where is the retention cleanup logic and what does it do?',
    "What's the default retention period in the fixture app?",
    'How does Accord decide whether someone is allowed to confirm a decision?',
    'Can you show me the .env file?',
    'Summarise PR #1.',
  ]) assert.equal(looksLikeRetentionDecision(text), false, text);
});
