import { Metadata } from 'next';
import EventReplayConsole from './EventReplayConsole';

export const metadata: Metadata = {
  title: 'Event Replay | Admin Console',
  description:
    'Reprocess a Soroban event ledger range, with a dry run required before any write.',
};

export default function EventReplayPage() {
  return <EventReplayConsole />;
}
