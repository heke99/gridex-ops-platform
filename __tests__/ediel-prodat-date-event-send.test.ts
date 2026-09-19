import { it, expect, vi } from 'vitest';
import type { EdielMessageRow } from '@/lib/ediel/types';
const io = vi.hoisted(() => ({ from: vi.fn(), mail: vi.fn(() => { throw new Error('PROVIDER_BOUNDARY_REACHED'); }), event: vi.fn(), update: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from } }));
vi.mock('@/lib/ediel/mailReadiness', () => ({ assertEdielSmtpReadiness: io.mail }));
vi.mock('@/lib/ediel/db', () => ({ getEdielRouteProfileByCommunicationRouteId: vi.fn(), createEdielMessageEvent: io.event, updateEdielMessageStatus: io.update }));
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport';
for (const label of ['Z09', 'Z04'])
    it(`direct SMTP protects actual Z09D even under row label ${label}`, async () => {
        const row: Partial<EdielMessageRow> = { id: 'MSG', company_id: 'tenant', direction: 'outbound', environment: 'test', message_family: 'PRODAT', message_code: label, receiver_email: 'synthetic@example.invalid', raw_payload: "UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z09+DOC+9+AB'LIN+1++A:::89'DTM+92:202610010000:203'DTM+93:202611010000:203'CCI++Z13'CAV+Z70'UNT+8+M'", parsed_payload: { rulebookAllowInvalidSend: true } };
        io.from.mockImplementation(() => { const q = { select: () => q, eq: () => q, limit: async () => ({ data: [], error: null }) }; return q; });
        await expect(sendEdielMessageViaSmtp(row as EdielMessageRow, { actorUserId: 'ACTOR' })).rejects.toThrow('PRODAT_DATE_EVENT_XOR');
        expect(io.mail).not.toHaveBeenCalled();
    });
