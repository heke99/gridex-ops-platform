import {describe, expect, it} from 'vitest'
import {
  assessEscoReportingStart,
  assessPhysicalMethodCompletion,
  assessSupplierMethodNotice,
} from '@/lib/ediel/rulebook/reportingObligationPolicy'

// Synthetic qualified semantic inputs, not real customer/DSO evidence.
describe('versioned current-source obligation dates', () => {
  it('keeps receipt-based supplier notice separate from the later physical date', () => {
    expect(assessSupplierMethodNotice({completeReceiptDay:'2026-10-01',changeRequired:true}))
      .toMatchObject({kind:'supplier_method_notice',status:'monitored_date',dueDay:'2026-11-10',requiresImmediateAction:true})
    expect(assessPhysicalMethodCompletion({completeReceiptDay:'2026-10-01',statedStartDay:'2026-10-10',changeRequired:true}))
      .toMatchObject({kind:'physical_method_completion',status:'monitored_date',dueDay:'2026-11-10',requiresImmediateAction:true})
    expect(assessPhysicalMethodCompletion({completeReceiptDay:'2026-10-01',statedStartDay:'2026-12-01',changeRequired:true}))
      .toMatchObject({dueDay:'2026-12-01'})
  })

  it.each([['2026-11-10','2026-11-10'],['2026-11-11','2026-11-11'],[null,'2026-11-10']])
    ('selects the physical boundary for stated date %s', (statedStartDay,dueDay) => {
      expect(assessPhysicalMethodCompletion({completeReceiptDay:'2026-10-01',statedStartDay,changeRequired:true}))
        .toMatchObject({status:'monitored_date',dueDay})
    })

  it('requires an actual applicable change and complete receipt; absence is not an already-quarterly finding', () => {
    expect(assessSupplierMethodNotice({completeReceiptDay:null,changeRequired:true})).toMatchObject({status:'held',dueDay:null})
    expect(assessPhysicalMethodCompletion({completeReceiptDay:'2026-10-01',statedStartDay:null,changeRequired:null}))
      .toMatchObject({status:'held',dueDay:null})
    expect(assessPhysicalMethodCompletion({completeReceiptDay:null,statedStartDay:null,changeRequired:false}))
      .toMatchObject({status:'not_applicable',dueDay:null})
  })

  it.each(['2026-02-30','2026-13-01','2026-1-01','2026-10-01T00:00:00Z',' 2026-10-01',''])
    ('holds malformed semantic day %s', completeReceiptDay => {
      expect(assessSupplierMethodNotice({completeReceiptDay,changeRequired:true})).toMatchObject({status:'held',dueDay:null})
      expect(assessPhysicalMethodCompletion({completeReceiptDay:'2026-10-01',statedStartDay:completeReceiptDay,changeRequired:true}))
        .toMatchObject({status:'held',dueDay:null})
      expect(assessEscoReportingStart({customerApprovalDay:completeReceiptDay,confirmedStartDay:null,settlementChangeRequired:false}))
        .toMatchObject({status:'held',dueDay:null})
    })

  it.each([
    ['2026-03-25','2026-04-01'],
    ['2026-10-21','2026-10-28'],
    ['2026-12-28','2027-01-04'],
    ['2028-02-25','2028-03-03'],
    ['2026-10-24','2026-10-31'],
  ])('counts calendar dates, retaining weekday across DST/month/year/leap boundaries: %s', (customerApprovalDay,dueDay) => {
    expect(assessEscoReportingStart({customerApprovalDay,confirmedStartDay:null,settlementChangeRequired:false}))
      .toMatchObject({status:'monitored_date',dueDay,basis:'conservative_internal_date',legalBreachDetermined:false})
  })

  it.each([['2020-01-01','2026-10-27'],['2026-10-20','2026-10-27'],['2026-10-22','2026-10-22'],['2026-11-10','2026-11-10']])
    ('does not add a second week to a later confirmed start %s', (confirmedStartDay,dueDay) => {
      expect(assessEscoReportingStart({customerApprovalDay:'2026-10-20',confirmedStartDay,settlementChangeRequired:false}))
        .toMatchObject({status:'monitored_date',dueDay,basis:'conservative_internal_date'})
    })

  it('holds missing customer approval and the separately unqualified settlement-method exception', () => {
    expect(assessEscoReportingStart({customerApprovalDay:null,confirmedStartDay:'2026-12-01',settlementChangeRequired:false}))
      .toMatchObject({status:'held',dueDay:null,missing:expect.arrayContaining(['customer_approval_day_required'])})
    expect(assessEscoReportingStart({customerApprovalDay:'2026-10-20',confirmedStartDay:null,settlementChangeRequired:true}))
      .toMatchObject({status:'held',dueDay:null,missing:['qualified_settlement_exception_anchor_required']})
    expect(assessEscoReportingStart({customerApprovalDay:'2026-10-20',confirmedStartDay:null,settlementChangeRequired:null}))
      .toMatchObject({status:'held',dueDay:null})
  })

  it('holds arithmetic outside the supported civil-date range instead of throwing', () => {
    expect(assessSupplierMethodNotice({completeReceiptDay:'9999-12-31',changeRequired:true})).toMatchObject({status:'held',dueDay:null})
    expect(assessEscoReportingStart({customerApprovalDay:'9999-12-31',confirmedStartDay:null,settlementChangeRequired:false}))
      .toMatchObject({status:'held',dueDay:null})
  })

  it('every assessment remains immutable, source-versioned and grants no action or legal-compliance conclusion', () => {
    const rows=[
      assessSupplierMethodNotice({completeReceiptDay:'2026-10-01',changeRequired:true}),
      assessPhysicalMethodCompletion({completeReceiptDay:null,statedStartDay:null,changeRequired:null}),
      assessEscoReportingStart({customerApprovalDay:'2026-10-20',confirmedStartDay:null,settlementChangeRequired:false}),
    ]
    for(const row of rows){
      expect(row).toMatchObject({version:'ediel-handbook-26b-obligations/2026-10-20.v1',legalBreachDetermined:false,authorizesProviderEntry:false,automaticResendAllowed:false})
      expect(row.sourceRefs.length).toBeGreaterThan(0)
      expect(Object.isFrozen(row)).toBe(true)
      expect(Object.isFrozen(row.missing)).toBe(true)
      expect(Object.isFrozen(row.sourceRefs)).toBe(true)
    }
  })
})
