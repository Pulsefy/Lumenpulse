import {
  verificationApi,
  serializeEvidenceWithAttachments,
  uploadEvidenceAttachment,
  MAX_ATTACHMENT_SIZE_BYTES,
  statusColor,
  statusLabel,
  requestStatusColor,
  requestStatusLabel,
  type VerificationEvidenceAttachment,
} from '../verification';
import { apiClient } from '../api-client';

jest.mock('../api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

describe('verification module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('serializeEvidenceWithAttachments', () => {
    it('returns clean text when no attachments provided', () => {
      expect(serializeEvidenceWithAttachments('Simple evidence')).toBe('Simple evidence');
      expect(serializeEvidenceWithAttachments('  Trimmed evidence  ')).toBe('Trimmed evidence');
      expect(serializeEvidenceWithAttachments('', [])).toBe('');
    });

    it('formats image, file and location attachments correctly', () => {
      const attachments: VerificationEvidenceAttachment[] = [
        {
          type: 'image',
          name: 'proof.png',
          url: 'https://cdn.example.com/proof.png',
        },
        {
          type: 'file',
          name: 'certificate.pdf',
          url: 'https://cdn.example.com/certificate.pdf',
        },
        {
          type: 'location',
          latitude: 37.77492,
          longitude: -122.41941,
        },
      ];

      const serialized = serializeEvidenceWithAttachments('Here is my proof:', attachments);
      expect(serialized).toContain('Here is my proof:');
      expect(serialized).toContain('[proof.png](https://cdn.example.com/proof.png)');
      expect(serialized).toContain('[certificate.pdf](https://cdn.example.com/certificate.pdf)');
      expect(serialized).toContain('[Location: 37.77492, -122.41941]');
    });

    it('handles empty text with attachments', () => {
      const attachments: VerificationEvidenceAttachment[] = [
        {
          type: 'location',
          latitude: 10.0,
          longitude: 20.0,
        },
      ];
      const serialized = serializeEvidenceWithAttachments('', attachments);
      expect(serialized).toBe('[Location: 10.00000, 20.00000]');
    });
  });

  describe('uploadEvidenceAttachment', () => {
    it('returns existing url immediately without re-uploading', async () => {
      const att: VerificationEvidenceAttachment = {
        type: 'image',
        name: 'existing.jpg',
        url: 'https://lumenpulse.io/existing.jpg',
      };
      const res = await uploadEvidenceAttachment(att);
      expect(res.success).toBe(true);
      expect(res.url).toBe('https://lumenpulse.io/existing.jpg');
    });

    it('rejects attachments that exceed the maximum allowed size limit', async () => {
      const att: VerificationEvidenceAttachment = {
        type: 'file',
        name: 'large_video.mp4',
        size: MAX_ATTACHMENT_SIZE_BYTES + 1024,
      };
      const res = await uploadEvidenceAttachment(att);
      expect(res.success).toBe(false);
      expect(res.error).toContain('File size exceeds the limit');
    });

    it('uploads valid attachments and reports progress', async () => {
      const att: VerificationEvidenceAttachment = {
        type: 'image',
        name: 'photo.jpg',
        size: 1024 * 50,
      };
      const progressSpy = jest.fn();
      const res = await uploadEvidenceAttachment(att, {
        onProgress: progressSpy,
      });

      expect(res.success).toBe(true);
      expect(res.url).toContain('https://verification-evidence.lumenpulse.io/');
      expect(progressSpy).toHaveBeenCalled();
    });

    it('handles aborted signal cleanly when connection or user drops upload', async () => {
      const controller = new AbortController();
      controller.abort();

      const att: VerificationEvidenceAttachment = {
        type: 'image',
        name: 'photo.jpg',
        size: 1024 * 50,
      };
      const res = await uploadEvidenceAttachment(att, {
        signal: controller.signal,
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe('Upload cancelled');
    });
  });

  describe('verificationApi request methods', () => {
    it('creates verification request with serialized evidence payload', async () => {
      (apiClient.post as jest.Mock).mockResolvedValue({
        success: true,
        data: {
          id: 'req-123',
          targetType: 'CONTRIBUTOR',
          targetId: 'GAAA',
          status: 'SUBMITTED',
          evidence: 'Proof text\n\nEvidence Attachments:\n[Photo](https://img.com/p.jpg)',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });

      const res = await verificationApi.createVerificationRequest({
        targetType: 'CONTRIBUTOR',
        targetId: 'GAAA',
        evidence: 'Proof text',
        requesterNote: 'Review note',
        attachments: [
          {
            type: 'image',
            name: 'Photo',
            url: 'https://img.com/p.jpg',
          },
        ],
      });

      expect(apiClient.post).toHaveBeenCalledWith('/verification-requests', {
        targetType: 'CONTRIBUTOR',
        targetId: 'GAAA',
        evidence: 'Proof text\n\nEvidence Attachments:\n[Photo](https://img.com/p.jpg)',
        requesterNote: 'Review note',
      });
      expect(res.success).toBe(true);
      expect(res.data?.id).toBe('req-123');
    });

    it('fetches submitted verification requests for current user', async () => {
      (apiClient.get as jest.Mock).mockResolvedValue({
        success: true,
        data: [
          {
            id: 'req-1',
            targetType: 'CONTRIBUTOR',
            targetId: 'user-1',
            status: 'SUBMITTED',
            evidence: 'Doc',
          },
        ],
      });

      const res = await verificationApi.getMyVerificationRequests();
      expect(apiClient.get).toHaveBeenCalledWith('/verification-requests/mine');
      expect(res.success).toBe(true);
      expect(res.data).toHaveLength(1);
    });

    it('fetches single verification request and cancels request', async () => {
      (apiClient.get as jest.Mock).mockResolvedValue({
        success: true,
        data: { id: 'req-1', status: 'SUBMITTED' },
      });
      (apiClient.post as jest.Mock).mockResolvedValue({
        success: true,
        data: { id: 'req-1', status: 'CANCELLED' },
      });

      const getRes = await verificationApi.getVerificationRequest('req-1');
      expect(apiClient.get).toHaveBeenCalledWith('/verification-requests/req-1');
      expect(getRes.success).toBe(true);

      const cancelRes = await verificationApi.cancelVerificationRequest('req-1');
      expect(apiClient.post).toHaveBeenCalledWith('/verification-requests/req-1/cancel', {});
      expect(cancelRes.success).toBe(true);
    });
  });

  describe('status color and label formatting', () => {
    it('returns appropriate color and label for project and request statuses', () => {
      expect(statusColor('VERIFIED')).toBe('#10b981');
      expect(statusColor('REJECTED')).toBe('#ef4444');
      expect(statusLabel('VERIFIED')).toBe('Lumenpulse Verified');
      expect(statusLabel('PENDING')).toBe('Pending Review');

      expect(requestStatusColor('APPROVED')).toBe('#10b981');
      expect(requestStatusColor('REJECTED')).toBe('#ef4444');
      expect(requestStatusColor('IN_REVIEW')).toBe('#3b82f6');
      expect(requestStatusColor('CHANGES_REQUESTED')).toBe('#f97316');
      expect(requestStatusColor('SUBMITTED')).toBe('#f59e0b');

      expect(requestStatusLabel('APPROVED')).toBe('Approved');
      expect(requestStatusLabel('IN_REVIEW')).toBe('In Review');
      expect(requestStatusLabel('CHANGES_REQUESTED')).toBe('Changes Requested');
      expect(requestStatusLabel('SUBMITTED')).toBe('Submitted');
    });
  });
});
