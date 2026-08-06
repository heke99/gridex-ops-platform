from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    content = file.read_text()
    count = content.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}")
    file.write_text(content.replace(old, new, 1))


replace_once(
    "lib/website/customerApplications.ts",
    '''    const filePath = buildCustomerDocumentStoragePath({
      companyId: input.companyId,
      customerId: input.customerId,
      siteId: null,
      documentType: "power_of_attorney",
      fileName: `${input.powerOfAttorneyId}.json`,
      timestampFileName: false,
    });''',
    '''    const filePath = buildCustomerDocumentStoragePath({
      companyId: input.companyId,
      customerId: input.customerId,
      siteId: input.customerSiteId,
      documentType: "power_of_attorney",
      fileName: `${input.powerOfAttorneyId}.json`,
      timestampFileName: false,
    });''',
)

replace_once(
    "lib/customer-documents/storagePath.ts",
    "const FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;\nconst DOCUMENT_TYPES",
    "const FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;\nconst MAX_FILE_NAME_LENGTH = 255;\nconst DOCUMENT_TYPES",
)
replace_once(
    "lib/customer-documents/storagePath.ts",
    "  return normalized.slice(0, 255);",
    "  return normalized.slice(0, MAX_FILE_NAME_LENGTH);",
)
replace_once(
    "lib/customer-documents/storagePath.ts",
    '''  const sanitizedFileName = sanitizeCustomerDocumentFileName(params.fileName);
  const fileName =
    params.timestampFileName === false
      ? sanitizedFileName
      : `${(params.now ?? new Date())
          .toISOString()
          .replace(/[:.]/g, "-")}_${sanitizedFileName}`;
''',
    '''  const timestampPrefix =
    params.timestampFileName === false
      ? ""
      : `${(params.now ?? new Date())
          .toISOString()
          .replace(/[:.]/g, "-")}_`;
  const sanitizedFileName = sanitizeCustomerDocumentFileName(params.fileName);
  const fileName = `${timestampPrefix}${sanitizedFileName.slice(
    0,
    MAX_FILE_NAME_LENGTH - timestampPrefix.length,
  )}`;
''',
)

replace_once(
    "__tests__/customer-document-signed-url.test.ts",
    "import { GET } from '@/app/api/admin/customer-documents/[documentId]/route'\n",
    "import { GET } from '@/app/api/admin/customer-documents/[documentId]/route'\nimport {\n  buildCustomerDocumentStoragePath,\n  parseCustomerDocumentStoragePath,\n} from '@/lib/customer-documents/storagePath'\n",
)

tests = Path("__tests__/customer-document-signed-url.test.ts")
test_marker = "describe('customer document storage path builder'"
if test_marker not in tests.read_text():
    tests.write_text(
        tests.read_text()
        + '''

describe('customer document storage path builder', () => {
  it('preserves site scope for site-bound website documents', () => {
    const path = buildCustomerDocumentStoragePath({
      companyId: companyA,
      customerId: customerA,
      siteId: siteA,
      documentType: 'power_of_attorney',
      fileName: 'authorization.json',
      timestampFileName: false,
    })

    expect(parseCustomerDocumentStoragePath(path)).toMatchObject({
      companyId: companyA,
      customerId: customerA,
      siteId: siteA,
      scope: `site-${siteA}`,
    })
  })

  it('caps the complete timestamped filename segment at 255 characters', () => {
    const path = buildCustomerDocumentStoragePath({
      companyId: companyA,
      customerId: customerA,
      siteId: null,
      documentType: 'complete_agreement',
      fileName: `${'a'.repeat(300)}.pdf`,
      now: new Date('2026-08-06T16:22:04.123Z'),
    })
    const parsed = parseCustomerDocumentStoragePath(path)

    expect(parsed).not.toBeNull()
    expect(parsed?.fileName.length).toBe(255)
    expect(parsed?.fileName.startsWith('2026-08-06T16-22-04-123Z_')).toBe(true)
  })
})
'''
    )

regression = Path("scripts/gridex-aud-001-customer-document-storage-isolation-regression.cjs")
regression_marker = '''assert.match(
  website,
  /documentType:\\s*"power_of_attorney"/,
  "website POA path must include the canonical document type",
);
'''
regression_addition = regression_marker + '''assert.match(
  website,
  /siteId:\\s*input\\.customerSiteId/,
  "website POA path scope must match the persisted site_id",
);
'''
regression_content = regression.read_text()
if regression_content.count(regression_marker) != 1:
    raise SystemExit("regression marker mismatch")
regression.write_text(regression_content.replace(regression_marker, regression_addition, 1))

report = Path("quality/remediation/gridex-aud-001-document-storage-isolation/REMEDIATION_REPORT.md")
report_marker = "## Ready-for-review follow-up"
if report_marker not in report.read_text():
    report.write_text(
        report.read_text()
        + '''

## Ready-for-review follow-up

Cursor Bugbot identified two valid defects after the PR left draft state:

- Website POA snapshots used customer scope while the authorization row could persist a non-null `site_id`. The canonical object path now uses `input.customerSiteId`, keeping Storage scope and database ownership aligned.
- Timestamped uploads could exceed the 255-character filename-segment limit. The builder now reserves space for the timestamp prefix before truncating the sanitized filename.

Both cases have regression coverage in the existing exact-head Vitest/static verification path. The PR must be reverified at its new head before merge.
'''
    )
