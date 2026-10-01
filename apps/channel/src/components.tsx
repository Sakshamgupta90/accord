/** @accord/channel — Channels native JSX components.
 * JSX components compiled with jsxImportSource: "@copilotkit/channels".
 */
import {
  Actions,
  Button,
  Context,
  Divider,
  Field,
  Fields,
  Header,
  Markdown,
  Message,
  Section,
} from '@copilotkit/channels';
import type { Finding, ThreadView } from '@accord/contracts';
import { formatScope } from '@accord/slack-delivery';

export function EnrollmentCard() {
  return (
    <Message accent="#2EB67D">
      <Header>Accord Active</Header>
      <Section>
        <Markdown>
          Accord is following this thread. I will compare confirmed retention decisions with the implementation and stored-record impact.
        </Markdown>
      </Section>
    </Message>
  );
}

/** Posted once when triage, not a mention, enrolled the thread. Says why Accord joined uninvited. */
export function TriageEnrollmentCard() {
  return (
    <Message accent="#2EB67D">
      <Header>Accord joined this thread</Header>
      <Section>
        <Markdown>
          This looks like a data retention decision, so Accord is following along. Only the decision owner can confirm it; I will then compare it with the implementation and stored-record impact. Mention me with a question any time.
        </Markdown>
      </Section>
    </Message>
  );
}

export function KnowledgeUploadCard({ accepted, skipped }: { accepted: string[]; skipped: string[] }) {
  return (
    <Message accent={accepted.length > 0 ? '#36C5F0' : '#E01E5A'}>
      <Header>Knowledge Base Upload</Header>
      <Section>
        <Markdown>
          {accepted.length > 0
            ? `Indexed ${accepted.length} document${accepted.length === 1 ? '' : 's'} for this channel: ${accepted.join(', ')}.`
            : 'No document was indexed.'}
        </Markdown>
      </Section>
      {skipped.length > 0 && (
        <Section>
          <Markdown>**Skipped:** {skipped.join(' · ')}</Markdown>
        </Section>
      )}
      <Context>Only redacted extracted text is stored; uploads are reference material, not Accord policy evidence.</Context>
    </Message>
  );
}

export interface StatusCardProps {
  view: ThreadView;
}

export function StatusCard({ view }: StatusCardProps) {
  if (!view.enrolled || !view.finding) {
    return <EnrollmentCard />;
  }

  const { finding, decision, contextRevision } = view;
  const statusLabel = finding.status.replace(/_/g, ' ').toUpperCase();

  return (
    <Message accent={finding.status === 'confirmed_conflict' ? '#E01E5A' : '#36C5F0'}>
      <Header>{finding.title || 'Accord Finding'}</Header>
      <Section>
        <Markdown>**Status:** {statusLabel} · Decision v{finding.decisionVersion}</Markdown>
      </Section>
      {decision?.intent && (
        <Section>
          <Markdown>{formatScope(decision.intent.scope, decision.intent.retentionDays)}</Markdown>
        </Section>
      )}
      {finding.impact && finding.impact.status === 'complete' && (
        <Fields>
          <Field label="Premature Records">
            {finding.impact.prematurelySelectedRecords !== null ? String(finding.impact.prematurelySelectedRecords) : 'unknown'}
          </Field>
          <Field label="Affected Accounts">
            {finding.impact.prematurelySelectedAccounts !== null ? String(finding.impact.prematurelySelectedAccounts) : 'unknown'}
          </Field>
          <Field label="Total Inspected">
            {finding.impact.observedSelectedTotal !== null ? String(finding.impact.observedSelectedTotal) : 'unknown'}
          </Field>
        </Fields>
      )}
      {finding.question && (
        <Section>
          <Markdown>**Clarification:** {finding.question}</Markdown>
        </Section>
      )}
      <Divider />
      <Context>Accord finding {finding.id} · revision {contextRevision}</Context>
    </Message>
  );
}

export interface ConfirmationCardProps {
  decisionId: string;
  expectedVersion: number;
  expectedContextRevision: number;
  onAction?: (kind: 'confirm' | 'tentative' | 'withdraw') => Promise<void>;
}

export function ConfirmationCard({
  decisionId,
  expectedVersion,
  expectedContextRevision,
  onAction,
}: ConfirmationCardProps) {
  return (
    <Message accent="#4A154B">
      <Header>Decision Review</Header>
      <Section>
        <Markdown>Confirm the current interpretation to authorize investigation against repository policy.</Markdown>
      </Section>
      <Actions>
        <Button
          style="primary"
          value="confirm"
          onClick={async () => {
            if (onAction) await onAction('confirm');
          }}
        >
          Confirm interpretation
        </Button>
        <Button
          value="tentative"
          onClick={async () => {
            if (onAction) await onAction('tentative');
          }}
        >
          Mark tentative
        </Button>
        <Button
          style="danger"
          value="withdraw"
          onClick={async () => {
            if (onAction) await onAction('withdraw');
          }}
        >
          Withdraw
        </Button>
      </Actions>
      <Context>decision:{decisionId} · v{expectedVersion} · rev{expectedContextRevision}</Context>
    </Message>
  );
}
