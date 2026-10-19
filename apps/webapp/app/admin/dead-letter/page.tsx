import { Metadata } from 'next';
import DeadLetterConsole from './DeadLetterConsole';

export const metadata: Metadata = {
  title: 'Dead Letters | Admin Console',
  description:
    'Inspect and replay messages that exhausted their delivery attempts in the outbox or the Soroban event indexer.',
};

export default function DeadLetterPage() {
  return <DeadLetterConsole />;
}
