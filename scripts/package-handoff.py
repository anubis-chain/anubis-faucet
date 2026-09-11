#!/usr/bin/env python3
"""Export a source-only handoff with independent Cloudflare configuration."""
import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parents[1]
package_name = "anubis-faucet-erc20-dai-video-source-2026-09-10"
output = root / "handoff"
output.mkdir(exist_ok=True)

# Deliberate allowlist: never recursively archive the working directory.
root_files = [
    "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts",
    "playwright.config.ts", "index.html", "DESIGN.md", ".gitignore",
    ".env.example", ".dev.vars.example",
]
files = {}
for name in root_files:
    files[name] = (root / name).read_bytes()
for directory in ["src", "public", "worker", "tests", "references", "docs", "scripts"]:
    for path in sorted((root / directory).rglob("*")):
        if path.is_symlink():
            raise SystemExit(f"Refusing symlink: {path.relative_to(root)}")
        if not path.is_file():
            continue
        relative = path.relative_to(root)
        if any(part.startswith(".") or part == "__pycache__" for part in relative.parts):
            continue
        files[relative.as_posix()] = path.read_bytes()

files["README.md"] = (root / "docs/HANDOFF.md").read_bytes().replace(
    b"(DEPLOY.zh-CN.md)", b"(docs/DEPLOY.zh-CN.md)")
config = json.loads((root / "wrangler.jsonc").read_text())
config.pop("account_id", None)
config["d1_databases"][0]["database_id"] = "00000000-0000-0000-0000-000000000000"
files["wrangler.jsonc"] = (json.dumps(config, indent=2) + "\n").encode()
files["worker/config.json"] = (json.dumps({
    "allowedOrigins": [],
    "turnstile": {"hostnames": ["faucet.example.com"], "action": "faucet_claim"},
}, indent=2) + "\n").encode()

# Scan local secret values without printing them or including their source files.
secret_values = []
for path in root.glob(".dev.vars*"):
    if path.is_file() and not path.name.endswith(".example"):
        for line in path.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                value = line.split("=", 1)[1].strip().strip("\"'")
                if len(value) >= 16:
                    secret_values.append(value.encode())
for name, data in files.items():
    if any(secret in data for secret in secret_values):
        raise SystemExit(f"Secret scan failed in {name}")

manifest = "".join(f"{hashlib.sha256(data).hexdigest()}  {name}\n"
                   for name, data in sorted(files.items()))
files["MANIFEST.sha256"] = manifest.encode()
archive = output / f"{package_name}.zip"
with ZipFile(archive, "w", ZIP_DEFLATED, compresslevel=9) as bundle:
    for name, data in sorted(files.items()):
        bundle.writestr(f"{package_name}/{name}", data)

with ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    assert len(bundle.namelist()) == len(files)
    for name, data in files.items():
        assert bundle.read(f"{package_name}/{name}") == data

checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
checksum_path = output / f"{archive.name}.sha256"
checksum_path.write_text(f"{checksum}  {archive.name}\n")
print(f"Archive: {archive}")
print(f"Files: {len(files)}, bytes: {archive.stat().st_size}")
print(f"SHA-256: {checksum}")
print("Checked: archive integrity, manifest contents, deployment placeholders, local secret exclusion")
