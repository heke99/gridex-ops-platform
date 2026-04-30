// lib/ediel/tgtTestData.ts

import type { EdielTestRoleCode, EdielTestSuite } from '@/lib/ediel/types'

export type EdielTgtExcelColumn = {
  index: number
  name: string
  testCase: string
}

export type EdielTgtExcelField = {
  fieldCode: string
  fieldName: string
  values: Record<string, string>
}

export type EdielTgtExcelBlock = {
  kind: 'PRODAT' | 'UTILTS'
  sourceWorkbook: string
  sourceSheet: string
  entityLabel: string
  entityNumbers: readonly string[]
  columns: readonly EdielTgtExcelColumn[]
  fields: readonly EdielTgtExcelField[]
}

export type EdielTgtCaseTestDataGroup = {
  block: EdielTgtExcelBlock
  columns: readonly EdielTgtExcelColumn[]
  fields: readonly EdielTgtExcelField[]
}

export type EdielTgtCaseTestData = {
  suite: EdielTestSuite
  roleCode: EdielTestRoleCode
  testCaseCode: string
  title: string
  sourceNote: string
  groups: readonly EdielTgtCaseTestDataGroup[]
}

const RAW_PRODAT_BLOCKS = [
  {
    "kind": "PRODAT",
    "sourceSheet": "Testkund 1 - 20 - elleverantör",
    "entityLabel": "Testkund 1",
    "entityNumbers": [
      "1"
    ],
    "columns": [
      {
        "index": 2,
        "name": "Testdata - Z03L",
        "testCase": ""
      },
      {
        "index": 3,
        "name": "Testdata - Z04L (register 1)",
        "testCase": "Testfall 1.2.1"
      },
      {
        "index": 4,
        "name": "Z04L - register nr 2",
        "testCase": "Testfall 1.2.1"
      },
      {
        "index": 5,
        "name": "Testdata - Z06F",
        "testCase": "Testfall 2.1.2"
      }
    ],
    "fields": [
      {
        "fieldCode": "209",
        "fieldName": "Anläggningsid",
        "values": {
          "Testdata - Z03L": "735999888000000017",
          "Testdata - Z04L (register 1)": "735999888000000017",
          "Z04L - register nr 2": "735999888000000017",
          "Testdata - Z06F": "735999888000000017"
        }
      },
      {
        "fieldCode": "210",
        "fieldName": "Avtal, startdatum",
        "values": {
          "Testdata - Z03L": "sätts av avsändaren (15:e i nästa månad)",
          "Testdata - Z04L (register 1)": "sätts av avsändaren (15:e i nästa månad)"
        }
      },
      {
        "fieldCode": "216",
        "fieldName": "Giltighetsdatum, fr.o.m.",
        "values": {
          "Testdata - Z06F": "sätts av avsändaren (dag 28 föregående månad, kl 00.00)"
        }
      },
      {
        "fieldCode": "249",
        "fieldName": "Födelsedatum",
        "values": {
          "Testdata - Z03L": "19450701 (optional)",
          "Testdata - Z04L (register 1)": "19450701"
        }
      },
      {
        "fieldCode": "508",
        "fieldName": "Tidslängd",
        "values": {
          "Testdata - Z04L (register 1)": "1 (2379=802)",
          "Testdata - Z06F": "1 (2379=802)"
        }
      },
      {
        "fieldCode": "213",
        "fieldName": "Uppskattad årsenergi",
        "values": {
          "Testdata - Z03L": "5800 (optional)",
          "Testdata - Z04L (register 1)": "5800",
          "Z04L - register nr 2": "2800"
        }
      },
      {
        "fieldCode": "214",
        "fieldName": "Konstant för mätare",
        "values": {
          "Testdata - Z04L (register 1)": "1",
          "Z04L - register nr 2": "1",
          "Testdata - Z06F": "2"
        }
      },
      {
        "fieldCode": "217",
        "fieldName": "Mätmetod",
        "values": {
          "Testdata - Z03L": "Z03 (nätägaren avgör)",
          "Testdata - Z04L (register 1)": "Z01 (profil)",
          "Testdata - Z06F": "Z01 (profil)"
        }
      },
      {
        "fieldCode": "218",
        "fieldName": "Antal siffror, mätare",
        "values": {
          "Testdata - Z04L (register 1)": "6",
          "Z04L - register nr 2": "6",
          "Testdata - Z06F": "6"
        }
      },
      {
        "fieldCode": "306",
        "fieldName": "Installationsstatus",
        "values": {
          "Testdata - Z04L (register 1)": "Z12(Aktiv)",
          "Testdata - Z06F": "Z12(Aktiv)"
        }
      },
      {
        "fieldCode": "307",
        "fieldName": "Tariffkod",
        "values": {
          "Testdata - Z04L (register 1)": "25A",
          "Testdata - Z06F": "25A"
        }
      },
      {
        "fieldCode": "220",
        "fieldName": "Prioritet",
        "values": {
          "Testdata - Z04L (register 1)": "A",
          "Testdata - Z06F": "A"
        }
      },
      {
        "fieldCode": "222",
        "fieldName": "Rapporteringsfrekvens",
        "values": {
          "Testdata - Z04L (register 1)": "M",
          "Testdata - Z06F": "M"
        }
      },
      {
        "fieldCode": "223",
        "fieldName": "Transaktionstyp",
        "values": {
          "Testdata - Z03L": "Z22 (Z03L)",
          "Testdata - Z04L (register 1)": "Z22 (Z04L)",
          "Testdata - Z06F": "E64 (Z06F)"
        }
      },
      {
        "fieldCode": "259",
        "fieldName": "Mätare, tidsintervall (räkneverkskod)",
        "values": {
          "Testdata - Z04L (register 1)": "201 (höglast)",
          "Z04L - register nr 2": "202 (låglast)",
          "Testdata - Z06F": "101 (enkeltariff)"
        }
      },
      {
        "fieldCode": "254",
        "fieldName": "Avräkningsmetod",
        "values": {
          "Testdata - Z04L (register 1)": "Z31 (schablonavräkning enl mätare)",
          "Testdata - Z06F": "Z31 (schablonavräkning enl mätare)"
        }
      },
      {
        "fieldCode": "242",
        "fieldName": "Produktkod",
        "values": {
          "Testdata - Z04L (register 1)": "L917 (Slutliga andelstal per BR, SU och NA)",
          "Z04L - register nr 2": "L917 (Slutliga andelstal per BR, SU och NA)",
          "Testdata - Z06F": "L917 (Slutliga andelstal per BR, SU och NA)"
        }
      },
      {
        "fieldCode": "224",
        "fieldName": "Mätarnummer",
        "values": {
          "Testdata - Z04L (register 1)": "M12345"
        }
      },
      {
        "fieldCode": "260",
        "fieldName": "Nätområdesid",
        "values": {
          "Testdata - Z03L": "TES",
          "Testdata - Z04L (register 1)": "TES",
          "Testdata - Z06F": "TES"
        }
      },
      {
        "fieldCode": "261",
        "fieldName": "Referens till avtal/fullmakt",
        "values": {
          "Testdata - Z03L": "sätts av avsändaren"
        }
      },
      {
        "fieldCode": "226",
        "fieldName": "Ärendereferens",
        "values": {
          "Testdata - Z03L": "sätts av avsändaren",
          "Testdata - Z04L (register 1)": "samma som i Z03",
          "Testdata - Z06F": "sätts av avsändarens system"
        }
      },
      {
        "fieldCode": "227",
        "fieldName": "Kund-id (DE 1131=SE2, 3055=260)",
        "values": {
          "Testdata - Z03L": "194507018820",
          "Testdata - Z04L (register 1)": "194507018820"
        }
      },
      {
        "fieldCode": "228",
        "fieldName": "Namn-elanvändare",
        "values": {
          "Testdata - Z03L": "MARGIT PAULSSON",
          "Testdata - Z04L (register 1)": "MARGIT PAULSSON"
        }
      },
      {
        "fieldCode": "229",
        "fieldName": "Adress-elanvändare",
        "values": {
          "Testdata - Z03L": "STORA VÄGEN 25",
          "Testdata - Z04L (register 1)": "STORA VÄGEN 25"
        }
      },
      {
        "fieldCode": "231",
        "fieldName": "Postnr-elanvändare",
        "values": {
          "Testdata - Z03L": "62020",
          "Testdata - Z04L (register 1)": "62020"
        }
      },
      {
        "fieldCode": "232",
        "fieldName": "Postort-elanvändare",
        "values": {
          "Testdata - Z03L": "KLINTEHAMN",
          "Testdata - Z04L (register 1)": "KLINTEHAMN"
        }
      },
      {
        "fieldCode": "316",
        "fieldName": "Land-elanvändare",
        "values": {
          "Testdata - Z03L": "SE",
          "Testdata - Z04L (register 1)": "SE"
        }
      },
      {
        "fieldCode": "233",
        "fieldName": "Anläggningsid",
        "values": {
          "Testdata - Z03L": "735999888000000017 (optional)",
          "Testdata - Z04L (register 1)": "735999888000000017",
          "Testdata - Z06F": "735999888000000017"
        }
      },
      {
        "fieldCode": "234",
        "fieldName": "Adress-anläggning",
        "values": {
          "Testdata - Z03L": "VÄDERMYREN 1:22 (optional)",
          "Testdata - Z04L (register 1)": "VÄDERMYREN 1:22",
          "Testdata - Z06F": "VÄDERMYREN 1:22"
        }
      },
      {
        "fieldCode": "235",
        "fieldName": "Postnr-anläggning",
        "values": {
          "Testdata - Z03L": "62020 (optional)",
          "Testdata - Z04L (register 1)": "62020",
          "Testdata - Z06F": "62020"
        }
      },
      {
        "fieldCode": "236",
        "fieldName": "Postort-anläggning",
        "values": {
          "Testdata - Z03L": "KLINTEHAMN (optional)",
          "Testdata - Z04L (register 1)": "KLINTEHAMN",
          "Testdata - Z06F": "KLINTEHAMN"
        }
      },
      {
        "fieldCode": "237",
        "fieldName": "Land-anläggning",
        "values": {
          "Testdata - Z03L": "SE (optional)",
          "Testdata - Z04L (register 1)": "SE",
          "Testdata - Z06F": "SE"
        }
      },
      {
        "fieldCode": "250",
        "fieldName": "Fakturamottagare ID",
        "values": {
          "Testdata - Z03L": "10011 (optional)",
          "Testdata - Z04L (register 1)": "10011",
          "Testdata - Z06F": "10011"
        }
      },
      {
        "fieldCode": "251",
        "fieldName": "Namn-fakturamottagare",
        "values": {
          "Testdata - Z03L": "CONNY PAULSSON (optional)",
          "Testdata - Z04L (register 1)": "CONNY PAULSSON",
          "Testdata - Z06F": "CONNY PAULSSON"
        }
      },
      {
        "fieldCode": "252",
        "fieldName": "Adress-fakturamottagare",
        "values": {
          "Testdata - Z03L": "ÅGATAN 145 (optional)",
          "Testdata - Z04L (register 1)": "ÅGATAN 145",
          "Testdata - Z06F": "ÅGATAN 145"
        }
      },
      {
        "fieldCode": "253",
        "fieldName": "Postnr-fakturamottgare",
        "values": {
          "Testdata - Z03L": "11543 (optional)",
          "Testdata - Z04L (register 1)": "11543",
          "Testdata - Z06F": "11543"
        }
      },
      {
        "fieldCode": "317",
        "fieldName": "Postort-fakturamottagare",
        "values": {
          "Testdata - Z03L": "STOCKHOLM (optional)",
          "Testdata - Z04L (register 1)": "STOCKHOLM",
          "Testdata - Z06F": "STOCKHOLM"
        }
      },
      {
        "fieldCode": "318",
        "fieldName": "Land-fakturamottagare",
        "values": {
          "Testdata - Z03L": "SE (optional)",
          "Testdata - Z04L (register 1)": "SE",
          "Testdata - Z06F": "SE"
        }
      },
      {
        "fieldCode": "262",
        "fieldName": "Balansansvarig",
        "values": {
          "Testdata - Z03L": "valfritt, skall finnas som balansansvarig i aktörsregistret",
          "Testdata - Z04L (register 1)": "samma som i Z03",
          "Testdata - Z06F": "91109"
        }
      }
    ],
    "sourceWorkbook": "TGT_PRODAT_Bilaga_1-Testdata_per_testkund_version_el_4-0-5.xlsx"
  },
  {
    "kind": "PRODAT",
    "sourceSheet": "Testkund 1 - 20 - elleverantör",
    "entityLabel": "Testkund 20",
    "entityNumbers": [
      "20"
    ],
    "columns": [
      {
        "index": 2,
        "name": "Testdata - Z01LK",
        "testCase": "Testfall 1.1.1"
      },
      {
        "index": 3,
        "name": "Testdata - Z02LK",
        "testCase": "Testfall 1.1.1"
      },
      {
        "index": 4,
        "name": "Testdata - Z03LK",
        "testCase": "Testfall 1.2.2"
      },
      {
        "index": 5,
        "name": "Testdata - Z04LK",
        "testCase": "Testfall 1.2.2"
      },
      {
        "index": 6,
        "name": "Testdata - Z05L",
        "testCase": "Testfall 3.1.1"
      }
    ],
    "fields": [
      {
        "fieldCode": "209",
        "fieldName": "Anläggningsid",
        "values": {
          "Testdata - Z01LK": "735999888000000208",
          "Testdata - Z02LK": "735999888000000208",
          "Testdata - Z03LK": "735999888000000208",
          "Testdata - Z04LK": "735999888000000208",
          "Testdata - Z05L": "735999888000000208"
        }
      },
      {
        "fieldCode": "210",
        "fieldName": "Avtal, startdatum",
        "values": {
          "Testdata - Z01LK": "sätts av avsändaren (10:e i nästa månad)",
          "Testdata - Z03LK": "sätts av avsändaren (10:e i nästa månad)",
          "Testdata - Z04LK": "sätts av avsändaren (10:e i nästa månad)"
        }
      },
      {
        "fieldCode": "211",
        "fieldName": "Avtal, slutdatum",
        "values": {
          "Testdata - Z05L": "sätts av avsändaren (15:e i nästa månad)"
        }
      },
      {
        "fieldCode": "508",
        "fieldName": "Tidslängd",
        "values": {
          "Testdata - Z04LK": "15 (2379=806)"
        }
      },
      {
        "fieldCode": "213",
        "fieldName": "Uppskattad årsenergi",
        "values": {
          "Testdata - Z04LK": "30000"
        }
      },
      {
        "fieldCode": "214",
        "fieldName": "Konstant för mätare",
        "values": {
          "Testdata - Z04LK": "2"
        }
      },
      {
        "fieldCode": "217",
        "fieldName": "Mätmetod",
        "values": {
          "Testdata - Z02LK": "Z04 (kvart)",
          "Testdata - Z03LK": "Z03 (nätägaren avgör)",
          "Testdata - Z04LK": "Z04 (kvart)"
        }
      },
      {
        "fieldCode": "218",
        "fieldName": "Antal siffror, mätare",
        "values": {
          "Testdata - Z04LK": "5"
        }
      },
      {
        "fieldCode": "306",
        "fieldName": "Installationsstatus",
        "values": {
          "Testdata - Z04LK": "Z12(Aktiv)"
        }
      },
      {
        "fieldCode": "222",
        "fieldName": "Rapporteringsfrekvens",
        "values": {
          "Testdata - Z04LK": "D"
        }
      },
      {
        "fieldCode": "223",
        "fieldName": "Transaktionstyp",
        "values": {
          "Testdata - Z01LK": "Z23 (Z01LK)",
          "Testdata - Z02LK": "Z23 (Z02LK)",
          "Testdata - Z03LK": "Z23 (Z03LK)",
          "Testdata - Z04LK": "Z23 (Z04LK)",
          "Testdata - Z05L": "Z22 (Z05L)"
        }
      },
      {
        "fieldCode": "259",
        "fieldName": "Mätare, tidsintervall (räkneverkskod)",
        "values": {
          "Testdata - Z04LK": "901"
        }
      },
      {
        "fieldCode": "254",
        "fieldName": "Avräkningsmetod",
        "values": {
          "Testdata - Z04LK": "Z32 (dygnsavräkning)"
        }
      },
      {
        "fieldCode": "242",
        "fieldName": "Produktkod",
        "values": {
          "Testdata - Z04LK": "L639Q (Uppmätt förbr. per NA, BR och SU)"
        }
      },
      {
        "fieldCode": "224",
        "fieldName": "Mätarnummer",
        "values": {
          "Testdata - Z04LK": "M12020"
        }
      },
      {
        "fieldCode": "260",
        "fieldName": "Nätområdesid",
        "values": {
          "Testdata - Z01LK": "TES",
          "Testdata - Z02LK": "TES",
          "Testdata - Z03LK": "TES",
          "Testdata - Z04LK": "TES",
          "Testdata - Z05L": "TES"
        }
      },
      {
        "fieldCode": "261",
        "fieldName": "Referens till avtal/fullmakt",
        "values": {
          "Testdata - Z01LK": "sätts av avsändaren",
          "Testdata - Z03LK": "sätts av avsändaren"
        }
      },
      {
        "fieldCode": "226",
        "fieldName": "Ärendereferens",
        "values": {
          "Testdata - Z01LK": "sätts av avsändaren",
          "Testdata - Z02LK": "samma som i Z01",
          "Testdata - Z03LK": "sätts av avsändaren",
          "Testdata - Z04LK": "samma som i Z03",
          "Testdata - Z05L": "sätts av avsändarens system"
        }
      },
      {
        "fieldCode": "227",
        "fieldName": "Kund-id (DE 1131=SE1, 3055=260)",
        "values": {
          "Testdata - Z01LK": "5560143041",
          "Testdata - Z02LK": "5560143041",
          "Testdata - Z03LK": "5560143041",
          "Testdata - Z04LK": "5560143041",
          "Testdata - Z05L": "5560143041"
        }
      },
      {
        "fieldCode": "228",
        "fieldName": "Namn-elanvändare",
        "values": {
          "Testdata - Z01LK": "BOLAGET XXX",
          "Testdata - Z02LK": "BOLAGET XXX",
          "Testdata - Z03LK": "BOLAGET XXX",
          "Testdata - Z04LK": "BOLAGET XXX",
          "Testdata - Z05L": "BOLAGET XXX"
        }
      },
      {
        "fieldCode": "229",
        "fieldName": "Adress-elanvändare",
        "values": {
          "Testdata - Z01LK": "BOX 55",
          "Testdata - Z02LK": "BOX 55",
          "Testdata - Z03LK": "BOX 55",
          "Testdata - Z04LK": "BOX 55",
          "Testdata - Z05L": "BOX 55"
        }
      },
      {
        "fieldCode": "231",
        "fieldName": "Postnr-elanvändare",
        "values": {
          "Testdata - Z01LK": "11820",
          "Testdata - Z02LK": "11820",
          "Testdata - Z03LK": "11820",
          "Testdata - Z04LK": "11820",
          "Testdata - Z05L": "11820"
        }
      },
      {
        "fieldCode": "232",
        "fieldName": "Postort-elanvändare",
        "values": {
          "Testdata - Z01LK": "STOCKHOLM",
          "Testdata - Z02LK": "STOCKHOLM",
          "Testdata - Z03LK": "STOCKHOLM",
          "Testdata - Z04LK": "STOCKHOLM",
          "Testdata - Z05L": "STOCKHOLM"
        }
      },
      {
        "fieldCode": "316",
        "fieldName": "Land-elanvändare",
        "values": {
          "Testdata - Z01LK": "SE",
          "Testdata - Z02LK": "SE",
          "Testdata - Z03LK": "SE",
          "Testdata - Z04LK": "SE",
          "Testdata - Z05L": "SE"
        }
      },
      {
        "fieldCode": "233",
        "fieldName": "Anläggningsid",
        "values": {
          "Testdata - Z02LK": "735999888000000208",
          "Testdata - Z04LK": "735999888000000208",
          "Testdata - Z05L": "735999888000000208"
        }
      },
      {
        "fieldCode": "234",
        "fieldName": "Adress-anläggning",
        "values": {
          "Testdata - Z02LK": "Guldgränd 12",
          "Testdata - Z04LK": "Guldgränd 12",
          "Testdata - Z05L": "Guldgränd 12"
        }
      },
      {
        "fieldCode": "235",
        "fieldName": "Postnr-anläggning",
        "values": {
          "Testdata - Z02LK": "11820",
          "Testdata - Z04LK": "11820",
          "Testdata - Z05L": "11820"
        }
      },
      {
        "fieldCode": "236",
        "fieldName": "Postort-anläggning",
        "values": {
          "Testdata - Z02LK": "STOCKHOLM",
          "Testdata - Z04LK": "STOCKHOLM",
          "Testdata - Z05L": "STOCKHOLM"
        }
      },
      {
        "fieldCode": "237",
        "fieldName": "Land-anläggning",
        "values": {
          "Testdata - Z02LK": "SE",
          "Testdata - Z04LK": "SE",
          "Testdata - Z05L": "SE"
        }
      },
      {
        "fieldCode": "262",
        "fieldName": "Balansansvarig",
        "values": {
          "Testdata - Z03LK": "valfritt, skall finnas som balansansvarig i aktörsregistret",
          "Testdata - Z04LK": "samma som i Z03",
          "Testdata - Z05L": "91109"
        }
      }
    ],
    "sourceWorkbook": "TGT_PRODAT_Bilaga_1-Testdata_per_testkund_version_el_4-0-5.xlsx"
  }
] as const satisfies readonly EdielTgtExcelBlock[]

const RAW_UTILTS_BLOCKS = [
  {
    "kind": "UTILTS",
    "sourceSheet": "Testanlägg 1 - 24 - lev och ba",
    "entityLabel": "Testanläggning 1",
    "entityNumbers": [
      "1"
    ],
    "columns": [
      {
        "index": 2,
        "name": "Testdata - S02",
        "testCase": ""
      }
    ],
    "fields": [
      {
        "fieldCode": "505",
        "fieldName": "Transaktionsid",
        "values": {
          "Testdata - S02": "sätts av avsändaren"
        }
      },
      {
        "fieldCode": "209",
        "fieldName": "Anläggningsid",
        "values": {
          "Testdata - S02": "735999888000001014"
        }
      },
      {
        "fieldCode": "260",
        "fieldName": "Nätområdesid",
        "values": {
          "Testdata - S02": "TES"
        }
      },
      {
        "fieldCode": "506",
        "fieldName": "Produkt id",
        "values": {
          "Testdata - S02": "8716867000030"
        }
      },
      {
        "fieldCode": "245",
        "fieldName": "Observationsperiod",
        "values": {
          "Testdata - S02": "sätts av avsändaren (ett år framåt i tiden från kommande månadsskifte)"
        }
      },
      {
        "fieldCode": "532",
        "fieldName": "Senaste uppdateringstidpunkt",
        "values": {
          "Testdata - S02": "sätts av avsändaren"
        }
      },
      {
        "fieldCode": "508",
        "fieldName": "Upplösning",
        "values": {
          "Testdata - S02": "802 (månad)"
        }
      },
      {
        "fieldCode": "223",
        "fieldName": "Anledning till transaktion",
        "values": {
          "Testdata - S02": "Z01 (Planning)"
        }
      },
      {
        "fieldCode": "264",
        "fieldName": "Enhet",
        "values": {
          "Testdata - S02": "KWH"
        }
      },
      {
        "fieldCode": "514",
        "fieldName": "Observationsid",
        "values": {
          "Testdata - S02": "1"
        }
      },
      {
        "fieldCode": "515",
        "fieldName": "Planerad periodisk kvantitet",
        "values": {
          "Testdata - S02": "sätts av avsändaren"
        }
      },
      {
        "fieldCode": "514",
        "fieldName": "Observationsid",
        "values": {
          "Testdata - S02": "2"
        }
      },
      {
        "fieldCode": "515",
        "fieldName": "Planerad periodisk kvantitet",
        "values": {
          "Testdata - S02": "sätts av avsändaren"
        }
      },
      {
        "fieldCode": "514",
        "fieldName": "Observationsid",
        "values": {
          "Testdata - S02": "3"
        }
      },
      {
        "fieldCode": "515",
        "fieldName": "Planerad periodisk kvantitet",
        "values": {
          "Testdata - S02": "sätts av avsändaren"
        }
      }
    ],
    "sourceWorkbook": "TGT_UTILTS_Bilaga_1-Testdata_per_testanl_version_el_3-0-1-v2025.xlsx"
  },
  {
    "kind": "UTILTS",
    "sourceSheet": "Testanlägg 1 - 24 - lev och ba",
    "entityLabel": "Testanläggning 4",
    "entityNumbers": [
      "4"
    ],
    "columns": [
      {
        "index": 2,
        "name": "Testdata - E66-S",
        "testCase": ""
      }
    ],
    "fields": [
      {
        "fieldCode": "505",
        "fieldName": "Transaktionsid",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren"
        }
      },
      {
        "fieldCode": "209",
        "fieldName": "Anläggningsid",
        "values": {
          "Testdata - E66-S": "735999888000004015"
        }
      },
      {
        "fieldCode": "260",
        "fieldName": "Nätområdesid",
        "values": {
          "Testdata - E66-S": "TES"
        }
      },
      {
        "fieldCode": "506",
        "fieldName": "Produkt id",
        "values": {
          "Testdata - E66-S": "8716867000030"
        }
      },
      {
        "fieldCode": "245",
        "fieldName": "Observationsperiod",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren (föregående månad)"
        }
      },
      {
        "fieldCode": "512",
        "fieldName": "Registreringstidpunkt",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren"
        }
      },
      {
        "fieldCode": "508",
        "fieldName": "Upplösning",
        "values": {
          "Testdata - E66-S": "802 (månad)"
        }
      },
      {
        "fieldCode": "223",
        "fieldName": "Anledning till transaktion",
        "values": {
          "Testdata - E66-S": "E88 (Billing Energy)"
        }
      },
      {
        "fieldCode": "264",
        "fieldName": "Enhet",
        "values": {
          "Testdata - E66-S": "KWH"
        }
      },
      {
        "fieldCode": "513",
        "fieldName": "Typ av anläggning",
        "values": {
          "Testdata - E66-S": "E17 (Consumption (förbrukning))"
        }
      },
      {
        "fieldCode": "514",
        "fieldName": "Observationsid",
        "values": {
          "Testdata - E66-S": "1"
        }
      },
      {
        "fieldCode": "527",
        "fieldName": "RegisterId",
        "values": {
          "Testdata - E66-S": "101"
        }
      },
      {
        "fieldCode": "224",
        "fieldName": "Mätarnummer",
        "values": {
          "Testdata - E66-S": "M-0041"
        }
      },
      {
        "fieldCode": "517",
        "fieldName": "Mätarställning",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren, föregående mätarställning"
        }
      },
      {
        "fieldCode": "530a",
        "fieldName": "Datum för föregående mätarställning",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren (föregående månads starttidpunkt)"
        }
      },
      {
        "fieldCode": "309",
        "fieldName": "Mätaravläsare",
        "values": {
          "Testdata - E66-S": "E27 (avläst av nätägaren)"
        }
      },
      {
        "fieldCode": "514",
        "fieldName": "Observationsid",
        "values": {
          "Testdata - E66-S": "2"
        }
      },
      {
        "fieldCode": "527",
        "fieldName": "RegisterId",
        "values": {
          "Testdata - E66-S": "101"
        }
      },
      {
        "fieldCode": "517",
        "fieldName": "Mätarställning",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren, (senaste) mätarställning"
        }
      },
      {
        "fieldCode": "530a",
        "fieldName": "Datum för senaste mätarställning",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren (föregående månads sluttidpunkt)"
        }
      },
      {
        "fieldCode": "309",
        "fieldName": "Mätaravläsare",
        "values": {
          "Testdata - E66-S": "E27 (avläst av nätägaren)"
        }
      },
      {
        "fieldCode": "514",
        "fieldName": "Observationsid",
        "values": {
          "Testdata - E66-S": "3"
        }
      },
      {
        "fieldCode": "516",
        "fieldName": "Uppnådd periodisk kvantitet",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren"
        }
      }
    ],
    "sourceWorkbook": "TGT_UTILTS_Bilaga_1-Testdata_per_testanl_version_el_3-0-1-v2025.xlsx"
  },
  {
    "kind": "UTILTS",
    "sourceSheet": "Testanlägg 1 - 24 - lev och ba",
    "entityLabel": "Testanläggning 5",
    "entityNumbers": [
      "5"
    ],
    "columns": [
      {
        "index": 2,
        "name": "Testdata - E66-S",
        "testCase": ""
      }
    ],
    "fields": [
      {
        "fieldCode": "505",
        "fieldName": "Transaktionsid",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren"
        }
      },
      {
        "fieldCode": "209",
        "fieldName": "Anläggningsid",
        "values": {
          "Testdata - E66-S": "735999888000005012"
        }
      },
      {
        "fieldCode": "260",
        "fieldName": "Nätområdesid",
        "values": {
          "Testdata - E66-S": "TES"
        }
      },
      {
        "fieldCode": "506",
        "fieldName": "Produkt id",
        "values": {
          "Testdata - E66-S": "8716867000030"
        }
      },
      {
        "fieldCode": "245",
        "fieldName": "Observationsperiod",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren (föregående månad)"
        }
      },
      {
        "fieldCode": "512",
        "fieldName": "Registreringstidpunkt",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren"
        }
      },
      {
        "fieldCode": "508",
        "fieldName": "Upplösning",
        "values": {
          "Testdata - E66-S": "802 (månad)"
        }
      },
      {
        "fieldCode": "223",
        "fieldName": "Anledning till transaktion",
        "values": {
          "Testdata - E66-S": "E88 (Billing Energy)"
        }
      },
      {
        "fieldCode": "264",
        "fieldName": "Enhet",
        "values": {
          "Testdata - E66-S": "KWH"
        }
      },
      {
        "fieldCode": "513",
        "fieldName": "Typ av anläggning",
        "values": {
          "Testdata - E66-S": "E17 (Consumption (förbrukning))"
        }
      },
      {
        "fieldCode": "514",
        "fieldName": "Observationsid",
        "values": {
          "Testdata - E66-S": "1"
        }
      },
      {
        "fieldCode": "224",
        "fieldName": "Mätarnummer",
        "values": {
          "Testdata - E66-S": "M-0051"
        }
      },
      {
        "fieldCode": "527",
        "fieldName": "RegisterId",
        "values": {
          "Testdata - E66-S": "203"
        }
      },
      {
        "fieldCode": "517",
        "fieldName": "Mätarställning",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren, föregående mätarställning"
        }
      },
      {
        "fieldCode": "530a",
        "fieldName": "Datum för föregående mätarställning",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren (föregående månads starttidpunkt)"
        }
      },
      {
        "fieldCode": "309",
        "fieldName": "Mätaravläsare",
        "values": {
          "Testdata - E66-S": "E27 (avläst av nätägaren)"
        }
      },
      {
        "fieldCode": "514",
        "fieldName": "Observationsid",
        "values": {
          "Testdata - E66-S": "2"
        }
      },
      {
        "fieldCode": "527",
        "fieldName": "RegisterId",
        "values": {
          "Testdata - E66-S": "203"
        }
      },
      {
        "fieldCode": "517",
        "fieldName": "Mätarställning",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren, senaste mätarställning"
        }
      },
      {
        "fieldCode": "530a",
        "fieldName": "Datum för senaste mätarställning",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren (föregående månads sluttidpunkt)"
        }
      },
      {
        "fieldCode": "309",
        "fieldName": "Mätaravläsare",
        "values": {
          "Testdata - E66-S": "E27 (avläst av nätägaren)"
        }
      },
      {
        "fieldCode": "514",
        "fieldName": "Observationsid",
        "values": {
          "Testdata - E66-S": "3"
        }
      },
      {
        "fieldCode": "527",
        "fieldName": "RegisterId",
        "values": {
          "Testdata - E66-S": "204"
        }
      },
      {
        "fieldCode": "224",
        "fieldName": "Mätarnummer",
        "values": {
          "Testdata - E66-S": "M-0051"
        }
      },
      {
        "fieldCode": "517",
        "fieldName": "Mätarställning",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren, föregående mätarställning"
        }
      },
      {
        "fieldCode": "530a",
        "fieldName": "Datum för föregående mätarställning",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren (föregående månads starttidpunkt)"
        }
      },
      {
        "fieldCode": "309",
        "fieldName": "Mätaravläsare",
        "values": {
          "Testdata - E66-S": "E27 (avläst av nätägaren)"
        }
      },
      {
        "fieldCode": "514",
        "fieldName": "Observationsid",
        "values": {
          "Testdata - E66-S": "4"
        }
      },
      {
        "fieldCode": "527",
        "fieldName": "RegisterId",
        "values": {
          "Testdata - E66-S": "204"
        }
      },
      {
        "fieldCode": "517",
        "fieldName": "Mätarställning",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren, senaste mätarställning"
        }
      },
      {
        "fieldCode": "530a",
        "fieldName": "Datum för senaste mätarställning",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren (föregående månads sluttidpunkt)"
        }
      },
      {
        "fieldCode": "309",
        "fieldName": "Mätaravläsare",
        "values": {
          "Testdata - E66-S": "E27 (avläst av nätägaren)"
        }
      },
      {
        "fieldCode": "514",
        "fieldName": "Observationsid",
        "values": {
          "Testdata - E66-S": "5"
        }
      },
      {
        "fieldCode": "516",
        "fieldName": "Uppnådd periodisk kvantitet",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren"
        }
      }
    ],
    "sourceWorkbook": "TGT_UTILTS_Bilaga_1-Testdata_per_testanl_version_el_3-0-1-v2025.xlsx"
  },
  {
    "kind": "UTILTS",
    "sourceSheet": "Testanlägg 1 - 24 - lev och ba",
    "entityLabel": "Testanläggning 7",
    "entityNumbers": [
      "7"
    ],
    "columns": [
      {
        "index": 2,
        "name": "Testdata - E66-S",
        "testCase": ""
      }
    ],
    "fields": [
      {
        "fieldCode": "505",
        "fieldName": "Transaktionsid",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren"
        }
      },
      {
        "fieldCode": "209",
        "fieldName": "Anläggningsid",
        "values": {
          "Testdata - E66-S": "735999888000007016"
        }
      },
      {
        "fieldCode": "260",
        "fieldName": "Nätområdesid",
        "values": {
          "Testdata - E66-S": "TES"
        }
      },
      {
        "fieldCode": "506",
        "fieldName": "Produkt id",
        "values": {
          "Testdata - E66-S": "8716867000030"
        }
      },
      {
        "fieldCode": "245",
        "fieldName": "Observationsperiod",
        "values": {
          "Testdata - E66-S": "Sätts av avsändaren, halva föregående månaden (1-18)"
        }
      },
      {
        "fieldCode": "512",
        "fieldName": "Registreringstidpunkt",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren"
        }
      },
      {
        "fieldCode": "508",
        "fieldName": "Upplösning",
        "values": {
          "Testdata - E66-S": "802 (månad)"
        }
      },
      {
        "fieldCode": "223",
        "fieldName": "Anledning till transaktion",
        "values": {
          "Testdata - E66-S": "E88 (Billing Energy)"
        }
      },
      {
        "fieldCode": "264",
        "fieldName": "Enhet",
        "values": {
          "Testdata - E66-S": "KWH"
        }
      },
      {
        "fieldCode": "513",
        "fieldName": "Typ av anläggning",
        "values": {
          "Testdata - E66-S": "E17 (Consumption (förbrukning))"
        }
      },
      {
        "fieldCode": "514",
        "fieldName": "Observationsid",
        "values": {
          "Testdata - E66-S": "1"
        }
      },
      {
        "fieldCode": "224",
        "fieldName": "Mätarnummer",
        "values": {
          "Testdata - E66-S": "M-0071"
        }
      },
      {
        "fieldCode": "527",
        "fieldName": "RegisterId",
        "values": {
          "Testdata - E66-S": "101"
        }
      },
      {
        "fieldCode": "517",
        "fieldName": "Mätarställning",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren, föregående mätarställning"
        }
      },
      {
        "fieldCode": "530a",
        "fieldName": "Datum för föregående mätarställning",
        "values": {
          "Testdata - E66-S": "Sätts av avsändaren, början av föregående månad"
        }
      },
      {
        "fieldCode": "309",
        "fieldName": "Mätaravläsare",
        "values": {
          "Testdata - E66-S": "E27 (avläst av nätägaren)"
        }
      },
      {
        "fieldCode": "514",
        "fieldName": "Observationsid",
        "values": {
          "Testdata - E66-S": "2"
        }
      },
      {
        "fieldCode": "527",
        "fieldName": "RegisterId",
        "values": {
          "Testdata - E66-S": "101"
        }
      },
      {
        "fieldCode": "517",
        "fieldName": "Mätarställning",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren, senaste mätarställning"
        }
      },
      {
        "fieldCode": "530a",
        "fieldName": "Datum för senaste mätarställning",
        "values": {
          "Testdata - E66-S": "Sätts av avsändaren, sista dagen i observationsperioden (18:e)"
        }
      },
      {
        "fieldCode": "309",
        "fieldName": "Mätaravläsare",
        "values": {
          "Testdata - E66-S": "E27 (avläst av nätägaren)"
        }
      },
      {
        "fieldCode": "514",
        "fieldName": "Observationsid",
        "values": {
          "Testdata - E66-S": "3"
        }
      },
      {
        "fieldCode": "516",
        "fieldName": "Uppnådd periodisk kvantitet",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren"
        }
      },
      {
        "fieldCode": "505",
        "fieldName": "Transaktionsid",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren, annan än ovan!"
        }
      },
      {
        "fieldCode": "209",
        "fieldName": "Anläggningsid",
        "values": {
          "Testdata - E66-S": "735999888000007016"
        }
      },
      {
        "fieldCode": "260",
        "fieldName": "Nätområdesid",
        "values": {
          "Testdata - E66-S": "TES"
        }
      },
      {
        "fieldCode": "506",
        "fieldName": "Produkt id",
        "values": {
          "Testdata - E66-S": "8716867000030"
        }
      },
      {
        "fieldCode": "245",
        "fieldName": "Observationsperiod",
        "values": {
          "Testdata - E66-S": "Sätts av avsändaren, halva föregående månaden (från 18:e)"
        }
      },
      {
        "fieldCode": "512",
        "fieldName": "Registreringstidpunkt",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren"
        }
      },
      {
        "fieldCode": "508",
        "fieldName": "Upplösning",
        "values": {
          "Testdata - E66-S": "802 (månad)"
        }
      },
      {
        "fieldCode": "223",
        "fieldName": "Anledning till transaktion",
        "values": {
          "Testdata - E66-S": "E88 (Billing Energy)"
        }
      },
      {
        "fieldCode": "264",
        "fieldName": "Enhet",
        "values": {
          "Testdata - E66-S": "KWH"
        }
      },
      {
        "fieldCode": "513",
        "fieldName": "Typ av anläggning",
        "values": {
          "Testdata - E66-S": "E17 (Consumption (förbrukning))"
        }
      },
      {
        "fieldCode": "514",
        "fieldName": "Observationsid",
        "values": {
          "Testdata - E66-S": "1"
        }
      },
      {
        "fieldCode": "224",
        "fieldName": "Mätarnummer",
        "values": {
          "Testdata - E66-S": "M-0071"
        }
      },
      {
        "fieldCode": "527",
        "fieldName": "RegisterId",
        "values": {
          "Testdata - E66-S": "101"
        }
      },
      {
        "fieldCode": "517",
        "fieldName": "Mätarställning",
        "values": {
          "Testdata - E66-S": "Samma som sista avläsningen ovan"
        }
      },
      {
        "fieldCode": "530a",
        "fieldName": "Datum för föregående mätarställning",
        "values": {
          "Testdata - E66-S": "Sätts av avsändaren, första dagen i observationsperioden (18:e)"
        }
      },
      {
        "fieldCode": "309",
        "fieldName": "Mätaravläsare",
        "values": {
          "Testdata - E66-S": "E27 (avläst av nätägaren)"
        }
      },
      {
        "fieldCode": "514",
        "fieldName": "Observationsid",
        "values": {
          "Testdata - E66-S": "2"
        }
      },
      {
        "fieldCode": "527",
        "fieldName": "RegisterId",
        "values": {
          "Testdata - E66-S": "101"
        }
      },
      {
        "fieldCode": "517",
        "fieldName": "Mätarställning",
        "values": {
          "Testdata - E66-S": "NULL"
        }
      },
      {
        "fieldCode": "530a",
        "fieldName": "Datum för senaste mätarställning",
        "values": {
          "Testdata - E66-S": "Sätts av avsändaren, sista dagen i observationsperioden, dvs första dagen i aktuell månad"
        }
      },
      {
        "fieldCode": "309",
        "fieldName": "Mätaravläsare",
        "values": {
          "Testdata - E66-S": "E27 (avläst av nätägaren)"
        }
      },
      {
        "fieldCode": "514",
        "fieldName": "Observationsid",
        "values": {
          "Testdata - E66-S": "3"
        }
      },
      {
        "fieldCode": "516",
        "fieldName": "Uppnådd periodisk kvantitet",
        "values": {
          "Testdata - E66-S": "NULL"
        }
      },
      {
        "fieldCode": "520",
        "fieldName": "Kvantitetskvalitet",
        "values": {
          "Testdata - E66-S": "46"
        }
      }
    ],
    "sourceWorkbook": "TGT_UTILTS_Bilaga_1-Testdata_per_testanl_version_el_3-0-1-v2025.xlsx"
  },
  {
    "kind": "UTILTS",
    "sourceSheet": "Testanlägg 4,9,12,14 - ESCO",
    "entityLabel": "Testanläggning 4",
    "entityNumbers": [
      "4"
    ],
    "columns": [
      {
        "index": 2,
        "name": "Testdata - E66-S",
        "testCase": ""
      }
    ],
    "fields": [
      {
        "fieldCode": "311",
        "fieldName": "Application Reference",
        "values": {
          "Testdata - E66-S": "23-DGI-E66-S"
        }
      },
      {
        "fieldCode": "509",
        "fieldName": "Underordnad roll",
        "values": {
          "Testdata - E66-S": "DGI"
        }
      },
      {
        "fieldCode": "505",
        "fieldName": "Transaktionsid",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren"
        }
      },
      {
        "fieldCode": "209",
        "fieldName": "Anläggningsid",
        "values": {
          "Testdata - E66-S": "735999888000004015"
        }
      },
      {
        "fieldCode": "260",
        "fieldName": "Nätområdesid",
        "values": {
          "Testdata - E66-S": "TES"
        }
      },
      {
        "fieldCode": "506",
        "fieldName": "Produkt id",
        "values": {
          "Testdata - E66-S": "8716867000030"
        }
      },
      {
        "fieldCode": "245",
        "fieldName": "Observationsperiod",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren (föregående månad)"
        }
      },
      {
        "fieldCode": "512",
        "fieldName": "Registreringstidpunkt",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren"
        }
      },
      {
        "fieldCode": "508",
        "fieldName": "Upplösning",
        "values": {
          "Testdata - E66-S": "802 (månad)"
        }
      },
      {
        "fieldCode": "223",
        "fieldName": "Anledning till transaktion",
        "values": {
          "Testdata - E66-S": "E23 (Periodic Meter Reading)"
        }
      },
      {
        "fieldCode": "264",
        "fieldName": "Enhet",
        "values": {
          "Testdata - E66-S": "KWH"
        }
      },
      {
        "fieldCode": "513",
        "fieldName": "Typ av anläggning",
        "values": {
          "Testdata - E66-S": "E17 (Consumption (förbrukning))"
        }
      },
      {
        "fieldCode": "514",
        "fieldName": "Observationsid",
        "values": {
          "Testdata - E66-S": "1"
        }
      },
      {
        "fieldCode": "527",
        "fieldName": "RegisterId",
        "values": {
          "Testdata - E66-S": "101"
        }
      },
      {
        "fieldCode": "224",
        "fieldName": "Mätarnummer",
        "values": {
          "Testdata - E66-S": "M-0041"
        }
      },
      {
        "fieldCode": "517",
        "fieldName": "Mätarställning",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren, föregående mätarställning"
        }
      },
      {
        "fieldCode": "530a",
        "fieldName": "Datum för föregående mätarställning",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren (föregående månads starttidpunkt)"
        }
      },
      {
        "fieldCode": "309",
        "fieldName": "Mätaravläsare",
        "values": {
          "Testdata - E66-S": "E27 (avläst av nätägaren)"
        }
      },
      {
        "fieldCode": "514",
        "fieldName": "Observationsid",
        "values": {
          "Testdata - E66-S": "2"
        }
      },
      {
        "fieldCode": "527",
        "fieldName": "RegisterId",
        "values": {
          "Testdata - E66-S": "101"
        }
      },
      {
        "fieldCode": "517",
        "fieldName": "Mätarställning",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren, (senaste) mätarställning"
        }
      },
      {
        "fieldCode": "530a",
        "fieldName": "Datum för senaste mätarställning",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren (föregående månads sluttidpunkt)"
        }
      },
      {
        "fieldCode": "309",
        "fieldName": "Mätaravläsare",
        "values": {
          "Testdata - E66-S": "E27 (avläst av nätägaren)"
        }
      },
      {
        "fieldCode": "514",
        "fieldName": "Observationsid",
        "values": {
          "Testdata - E66-S": "3"
        }
      },
      {
        "fieldCode": "516",
        "fieldName": "Uppnådd periodisk kvantitet",
        "values": {
          "Testdata - E66-S": "sätts av avsändaren"
        }
      }
    ],
    "sourceWorkbook": "TGT_UTILTS_Bilaga_1-Testdata_per_testanl_version_el_3-0-1-v2025.xlsx"
  }
] as const satisfies readonly EdielTgtExcelBlock[]

const IMPORTANT_FIELD_CODES = new Set([
  // Core PRODAT object, customer and contract fields.
  // Keep these in the reduced testdata view; otherwise the TGT generator can
  // create structurally valid EDIFACT with empty customer fields.
  '209',
  '210',
  '211',
  '213',
  '214',
  '216',
  '217',
  '218',
  '220',
  '222',
  '223',
  '224',
  '226',
  '227',
  '228',
  '229',
  '231',
  '232',
  '233',
  '234',
  '235',
  '236',
  '237',
  '242',
  '245',
  '249',
  '250',
  '251',
  '252',
  '253',
  '254',
  '259',
  '260',
  '261',
  '262',
  '264',
  '306',
  '307',
  '309',
  '311',
  '316',
  '317',
  '318',

  // UTILTS and metering-series fields.
  '505',
  '506',
  '508',
  '509',
  '512',
  '513',
  '514',
  '515',
  '516',
  '517',
  '520',
  '527',
  '530a',
  '532',
])

function normalize(value: string): string {
  return value.trim().toUpperCase()
}

function blockByEntity(blocks: readonly EdielTgtExcelBlock[], entityNumber: string, sourceSheetIncludes?: string): EdielTgtExcelBlock | null {
  return (
    blocks.find((block) => {
      if (!block.entityNumbers.includes(entityNumber)) return false
      if (sourceSheetIncludes && !block.sourceSheet.toLowerCase().includes(sourceSheetIncludes.toLowerCase())) return false
      return true
    }) ?? null
  )
}

function pickColumns(block: EdielTgtExcelBlock, selectors: string[]): EdielTgtExcelColumn[] {
  const normalizedSelectors = selectors.map(normalize)
  const selected = block.columns.filter((column) => {
    const haystack = normalize(column.name + ' ' + column.testCase)
    return normalizedSelectors.some((selector) => haystack.includes(selector))
  })
  return selected.length > 0 ? selected : [...block.columns]
}

function pickFields(block: EdielTgtExcelBlock, columns: readonly EdielTgtExcelColumn[]): EdielTgtExcelField[] {
  const selectedColumnNames = new Set(columns.map((column) => column.name))
  const hasValueInSelectedColumn = (field: EdielTgtExcelField) =>
    Object.entries(field.values).some(([columnName, value]) => selectedColumnNames.has(columnName) && value.trim().length > 0)

  const important = block.fields.filter((field) => IMPORTANT_FIELD_CODES.has(field.fieldCode) && hasValueInSelectedColumn(field))
  const fallback = block.fields.filter(hasValueInSelectedColumn)
  return important.length > 0 ? important : fallback.slice(0, 20)
}

function groupFor(block: EdielTgtExcelBlock | null, columnSelectors: string[]): EdielTgtCaseTestDataGroup[] {
  if (!block) return []
  const columns = pickColumns(block, columnSelectors)
  return [
    {
      block,
      columns,
      fields: pickFields(block, columns),
    },
  ]
}

function groupsFor(blocks: Array<EdielTgtExcelBlock | null>, columnSelectors: string[]): EdielTgtCaseTestDataGroup[] {
  return blocks.flatMap((block) => groupFor(block, columnSelectors))
}

export function getEdielTgtTestDataForCase(
  suite: EdielTestSuite,
  roleCode: EdielTestRoleCode,
  testCaseCode: string
): EdielTgtCaseTestData | null {
  const code = normalize(testCaseCode)

  if (suite === 'PRODAT' && roleCode === 'supplier' && code === '1.2.1') {
    return {
      suite,
      roleCode,
      testCaseCode,
      title: 'Testkund 1 · Z03L/Z04L extra information',
      sourceNote: 'Importerad från PRODAT bilaga 1, elmarknad. Används för TGT 1.2.1.',
      groups: groupFor(blockByEntity(RAW_PRODAT_BLOCKS, '1'), ['Z03L', 'Z04L']),
    }
  }

  if (suite === 'PRODAT' && roleCode === 'supplier' && code === '1.2.2') {
    return {
      suite,
      roleCode,
      testCaseCode,
      title: 'Testkund 20 · Z03LK/Z04LK minsta information',
      sourceNote: 'Importerad från PRODAT bilaga 1, elmarknad. Används för TGT 1.2.2.',
      groups: groupFor(blockByEntity(RAW_PRODAT_BLOCKS, '20'), ['Z03LK', 'Z04LK']),
    }
  }

  if (suite === 'PRODAT' && roleCode === 'supplier' && code === '1.2.5') {
    return {
      suite,
      roleCode,
      testCaseCode,
      title: 'Testkund S1 · Z04D mottagningspliktig mikroproduktion',
      sourceNote: 'Data hämtas från PRODAT-testdataregistret. Om Edielportalen visar avvikande värden ska testdataregistret uppdateras, inte generatorn hårdkodas.',
      groups: groupFor(blockByEntity(RAW_PRODAT_BLOCKS, '1'), ['Z03L', 'Z04L']),
    }
  }


  if (suite === 'UTILTS' && roleCode === 'supplier' && code === 'U2.1') {
    return {
      suite,
      roleCode,
      testCaseCode,
      title: 'UTILTS E66 · korrekt mottagning',
      sourceNote: 'Importerad från UTILTS bilaga 1, elmarknad. Visar representativa E66-S testanläggningar för leverantörsrollen.',
      groups: groupsFor(
        [
          blockByEntity(RAW_UTILTS_BLOCKS, '4', 'lev'),
          blockByEntity(RAW_UTILTS_BLOCKS, '5', 'lev'),
          blockByEntity(RAW_UTILTS_BLOCKS, '7', 'lev'),
        ],
        ['E66-S']
      ),
    }
  }

  if (suite === 'UTILTS' && roleCode === 'supplier' && code === 'U2.2') {
    return {
      suite,
      roleCode,
      testCaseCode,
      title: 'UTILTS E66 · felhantering',
      sourceNote: 'Importerad från UTILTS bilaga 1, elmarknad. Används som underlag för negativ APERAK/UTILTS-ERR-test.',
      groups: groupsFor(
        [
          blockByEntity(RAW_UTILTS_BLOCKS, '5', 'lev'),
          blockByEntity(RAW_UTILTS_BLOCKS, '7', 'lev'),
        ],
        ['E66-S']
      ),
    }
  }

  return null
}

export function getEdielTgtAvailableTestDataBlocks(): readonly EdielTgtExcelBlock[] {
  return [...RAW_PRODAT_BLOCKS, ...RAW_UTILTS_BLOCKS]
}
