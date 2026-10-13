"""Render reviewed rowset guards into SQL; never connects to a database."""
import argparse
import json
import re
from pathlib import Path


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def render(policy, baseline):
    rows = {row["scope_name"]: row for row in baseline}
    scopes = sorted(policy["scopes"], key=lambda row: row["delete_order"])
    values = []
    for scope in scopes:
        name = scope["scope"]
        row = rows.get(name)
        if row is None or row["table_name"] != scope["table"]:
            raise ValueError(f"Missing/mismatched baseline: {name}")
        if not re.fullmatch(r"[a-z_][a-z_0-9]*", scope["table"]):
            raise ValueError("Invalid reviewed table name")
        count = row["exact_count"]
        if not isinstance(count, int) or count < 0:
            raise ValueError(f"Invalid count: {name}")
        expected = scope["expected_count"]
        if expected is not None and count != expected:
            raise ValueError(f"New/unreviewed producer rows: {name} expected {expected}, got {count}")
        fingerprint = row["row_fingerprint"]
        if not re.fullmatch(r"[a-f0-9]{32}", fingerprint):
            raise ValueError(f"Invalid fingerprint: {name}")
        values.append("(" + ",".join([
            quote(name), quote(scope["table"]), quote(scope["predicate"]),
            str(count), quote(fingerprint), str(scope["delete_order"]),
        ]) + ")")
    if set(rows) != {row["scope"] for row in scopes}:
        raise ValueError("Unexpected baseline scopes")
    empty_values = ",".join("(" + quote(table) + ")" for table in policy["assert_empty_tables"])
    preserve_values = ",".join("(" + quote(table) + ")" for table in policy["preserve_tables"])
    template = Path(__file__).with_name("reset-customer-flow.template.sql").read_text()
    return (template.replace("__SCOPED_BASELINE__", ",\n".join(values))
            .replace("__EMPTY_TABLES__", empty_values)
            .replace("__PRESERVED_TABLES__", preserve_values))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, default=Path(__file__).with_name("reset-approved-baseline.json"))
    parser.add_argument("--policy", type=Path, default=Path(__file__).with_name("reset-approved-scopes.json"))
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("reset-customer-flow.sql"))
    args = parser.parse_args()
    sql = render(json.loads(args.policy.read_text()), json.loads(args.baseline.read_text()))
    args.output.write_text(sql)
    print(f"Prepared {args.output}; live execution is root-only.")
