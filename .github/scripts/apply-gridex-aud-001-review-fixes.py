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
