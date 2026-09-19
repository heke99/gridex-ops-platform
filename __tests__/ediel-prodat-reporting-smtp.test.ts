import { it, expect, vi } from 'vitest';
import type { EdielMessageRow } from '@/lib/ediel/types';
import { reportingId, reportingSegments } from './fixtures/prodat-reporting-permission';
const io = vi.hoisted(() => ({ from: vi.fn(), provider: vi.fn(() => { throw new Error('PROVIDER_BOUNDARY_REACHED'); }), event: vi.fn(), update: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from } }));
vi.mock('@/lib/ediel/mailReadiness', () => ({ assertEdielSmtpReadiness: io.provider }));
vi.mock('@/lib/ediel/db', () => ({ getEdielRouteProfileByCommunicationRouteId: vi.fn(), createEdielMessageEvent: io.event, updateEdielMessageStatus: io.update }));
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport';
for (const label of ['Z13', 'Z04'])
    it(`actual SMTP blocks unsourced raw Z13 under row ${label}`, async () => {
        const q = { select: () => q, eq: () => q, limit: async () => ({ data: [], error: null }) };
        io.from.mockReturnValue(q);
        const row = { id: reportingId(90), company_id: reportingId(10), direction: 'outbound', environment: 'test', message_family: 'PRODAT', message_code: label, receiver_email: 'portal@example.invalid', raw_payload: reportingSegments().join("'") + "'UNT+13+M'", parsed_payload: { rulebookAllowInvalidSend: true } } as unknown as EdielMessageRow;
        await expect(sendEdielMessageViaSmtp(row, { actorUserId: reportingId(12) })).rejects.toThrow(/PRODAT_(REPORTING|REGISTER|DEPENDENT)/);
        expect(io.provider).not.toHaveBeenCalled();
    });
