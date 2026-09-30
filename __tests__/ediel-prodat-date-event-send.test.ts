import { it, expect, vi } from 'vitest';
import type { EdielMessageRow } from '@/lib/ediel/types';
import {raw,line,characteristic} from './fixtures/prodat-register';
import {head} from './fixtures/prodat-identity';
const io = vi.hoisted(() => ({ from: vi.fn(), rpc:vi.fn(), mail: vi.fn(() => { throw new Error('PROVIDER_BOUNDARY_REACHED'); }), event: vi.fn(), update: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from,rpc:io.rpc } }));
vi.mock('@/lib/ediel/mailReadiness', () => ({ assertEdielSmtpReadiness: io.mail }));
vi.mock('@/lib/ediel/db', () => ({ getEdielRouteProfileByCommunicationRouteId: vi.fn(), createEdielMessageEvent: io.event, updateEdielMessageStatus: io.update }));
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport';
for (const label of ['Z09', 'Z04'])
    it(`direct SMTP protects actual Z09D even under row label ${label}`, async () => {
        const rawPayload=raw([...head(),line('1','735123456789012345',undefined,'9'),['DTM',['92','202610010000','203']],['DTM',['93','202611010000','203']],...characteristic('Z13','Z70')],'Z09');
        const row: Partial<EdielMessageRow> = { id: '00000000-0000-4000-8000-000000000001', company_id: '00000000-0000-4000-8000-000000000002', direction: 'outbound', environment: 'test', message_standard:'edifact',mime_type:'application/edifact',message_family: 'PRODAT', message_code: label, receiver_email: 'synthetic@example.invalid', raw_payload:rawPayload, parsed_payload: { rulebookAllowInvalidSend: true } };
        io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{expect(name).toBe('gridex_ediel_accepted_transport_projection_v1');expect(args).toEqual({p_company_id:row.company_id,p_environment:'test',p_message_id:row.id,p_actor_user_id:'ACTOR'});return{data:null,error:null}});
        io.from.mockImplementation(() => { const q = { select: () => q, eq: () => q, limit: async () => ({ data: [], error: null }) }; return q; });
        await expect(sendEdielMessageViaSmtp(row as EdielMessageRow, { actorUserId: 'ACTOR' })).rejects.toThrow('PRODAT_DATE_EVENT_XOR');
        expect(io.mail).not.toHaveBeenCalled();
    });
