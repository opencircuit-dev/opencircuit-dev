import argparse
import hashlib
import json
import os
import pathlib
import re
import shutil
import sys
import tarfile
import tempfile


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_archive(archive, version):
    required = {
        "package.json", "README.md", "dist/oc.js", "dist/index.js", "dist/meta.json",
        "dist/commands/initTemplates.d.ts", "dist/templateInstaller.d.ts",
    }
    required.update(f"templates/config-{provider}.yaml" for provider in (
        "openai", "anthropic", "gemini", "byom", "meta", "olmo",
    ))
    names, regular = set(), set()
    total_size = 0
    with tarfile.open(archive, "r:gz") as bundle:
        for member in bundle:
            name = member.name.rstrip("/") if member.isdir() else member.name
            parts = name.split("/")
            if (
                not name or parts[0] != "package" or "\\" in name
                or any(part in ("", ".", "..") for part in parts)
                or any(ord(character) < 32 or ord(character) == 127 for character in name)
                or name in names or not (member.isfile() or member.isdir())
            ):
                raise ValueError(f"unsafe or duplicate archive member: {name}")
            names.add(name)
            total_size += member.size
            if len(names) > 100000 or total_size > 1024 * 1024 * 1024:
                raise ValueError("release archive exceeds inspection limits")
            if any(
                part.lower() in ("node_modules", ".npmrc", ".env", "credentials")
                or part.lower().startswith((".env.", "credentials."))
                or part.lower().endswith((".pem", ".key"))
                for part in parts[1:]
            ) or name in (
                "package/templates/config-cisco.yaml", "package/templates/config-devnet.yaml",
            ):
                raise ValueError(f"forbidden public release member: {name}")
            if member.isfile():
                regular.add(name.removeprefix("package/"))
        if not required.issubset(regular):
            raise ValueError("release archive is missing required CLI files")
        metadata = bundle.getmember("package/package.json")
        if metadata.size > 1024 * 1024:
            raise ValueError("release package metadata exceeds inspection limit")
        package = json.load(bundle.extractfile(metadata))
    if (
        package.get("name") != "@opencircuit/cli" or package.get("version") != version
        or package.get("main") != "dist/index.js" or package.get("bin", {}).get("oc") != "dist/oc.js"
    ):
        raise ValueError("release archive package identity/version/entry points mismatch")
    return sorted(name for name in regular if re.fullmatch(r"templates/config-[a-z0-9-]+\.yaml", name))


def replace_section(content, label, replacement):
    start, end = f"<!-- {label}_START -->", f"<!-- {label}_END -->"
    if content.count(start) != 1 or content.count(end) != 1 or content.index(start) >= content.index(end):
        raise ValueError(f"missing or ambiguous documentation markers: {label}")
    before, remainder = content.split(start)
    _, after = remainder.split(end)
    return before + start + "\n\n" + replacement.strip() + "\n\n" + end + after


def render_document(content, filename, version, templates, quickstart=False):
    links = f"- [`{filename}`]({filename})\n- [`{filename}.sha256`]({filename}.sha256)"
    if quickstart:
        links = "For the newest release, download the root-level bundle and checksum:\n\n" + links
    content = replace_section(content, "LATEST_ARTIFACT", links)
    if not quickstart:
        content = replace_section(content, "VERSIONS_TABLE", (
            "| Version | Artifact | Checksum |\n| ------- | -------- | -------- |\n"
            f"| `v{version}` | [`{filename}`]({filename}) | [`{filename}.sha256`]({filename}.sha256) |"
        ))
        content = content.replace("publishes signed, versioned release tarballs", "publishes versioned release tarballs with SHA-256 checksums")
    template_text = (
        f"## Packaged Configuration\n\nThis release includes {len(templates)} starter templates:\n\n"
        + "\n".join(f"- `{pathlib.PurePosixPath(name).name}`" for name in templates)
        + "\n\nThe CLI installs these templates under `~/.ocircuit/templates/`. Select one\n"
        "for `~/.ocircuit/config.yaml`; keep provider credentials in the private\n"
        "`~/.ocircuit/.env` file, not in a template. Do not activate multiple provider configs.\n\n"
        "```bash\ncp ~/.ocircuit/templates/config-openai.yaml ~/.ocircuit/config.yaml\n"
        "chmod 600 ~/.ocircuit/config.yaml\n```\n\n"
        "Meta uses `META_MODEL_API_KEY`. For OLMo, set your Ollama server address\n"
        "in `config-olmo.yaml`; OLMo sessions are chat-only with tools disabled."
    )
    if "<!-- PACKAGED_CONFIGURATION_" not in content:
        section = "<!-- PACKAGED_CONFIGURATION_START -->\n\n<!-- PACKAGED_CONFIGURATION_END -->\n\n"
        anchor = "## 5. First commands" if quickstart else "## License"
        if content.count(anchor) == 1:
            content = content.replace(anchor, section + anchor)
        else:
            content = content.rstrip() + "\n\n" + section
    return replace_section(content, "PACKAGED_CONFIGURATION", template_text)


def refresh_release(source, destination, artifact=None):
    source, destination = pathlib.Path(source).resolve(strict=True), pathlib.Path(destination).resolve(strict=True)
    if source == destination:
        raise ValueError("source and distribution checkouts must be distinct")
    package = json.loads((source / "extensions/cli/package.json").read_text())
    version = package.get("version", "")
    if package.get("name") != "@opencircuit/cli" or not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("source CLI identity/version is invalid")
    filename = f"opencircuit-cli-{version}.tgz"
    staged = source / "release-artifacts" / f"v{version}" / filename
    archive = pathlib.Path(artifact) if artifact else staged
    if archive.is_symlink() or not archive.is_file() or archive.name != filename:
        raise ValueError("expected release archive missing or unsafe")
    checksum_path = archive.with_name(filename + ".sha256")
    if checksum_path.is_symlink() or not checksum_path.is_file() or checksum_path.stat().st_size > 1024:
        raise ValueError("release checksum missing or unsafe")
    digest = sha256(archive)
    checksum = f"{digest}  {filename}\n".encode()
    if checksum_path.read_bytes() != checksum:
        raise ValueError("release checksum mismatch")
    templates = inspect_archive(archive, version)
    current = tuple(map(int, version.split(".")))
    release_root = source / "release-artifacts"
    if release_root.is_symlink() or staged.parent.is_symlink():
        raise ValueError("unsafe source release staging directory")
    if release_root.exists():
        for child in release_root.iterdir():
            match = re.fullmatch(r"v(\d+)\.(\d+)\.(\d+)", child.name)
            if match and tuple(map(int, match.groups())) > current:
                raise ValueError("refusing a staged release downgrade")
    stale = []
    for child in destination.iterdir():
        match = re.fullmatch(r"opencircuit-cli-(\d+)\.(\d+)\.(\d+)\.tgz(?:\.sha256)?", child.name)
        if match:
            if tuple(map(int, match.groups())) > current:
                raise ValueError("refusing a distribution release downgrade")
            if child.name not in (filename, filename + ".sha256"):
                stale.append(child)
    desired = {
        staged: archive, staged.with_name(filename + ".sha256"): checksum,
        destination / filename: archive, destination / (filename + ".sha256"): checksum,
    }
    for name in ("README.md", "QUICKSTART.md"):
        document = destination / name
        if document.is_symlink() or not document.is_file():
            raise ValueError(f"missing or unsafe release document: {name}")
        desired[document] = render_document(document.read_text(), filename, version, templates, name == "QUICKSTART.md").encode()
    for target in set(desired) | set(stale):
        if target.is_symlink() or (target.exists() and not target.is_file()):
            raise ValueError(f"unsafe release output: {target}")
    prepared, backups = {}, {}
    rollback_complete = True
    created_directory = not staged.parent.exists()
    staged.parent.mkdir(parents=True, exist_ok=True)
    try:
        for target, value in desired.items():
            descriptor, temporary = tempfile.mkstemp(prefix=".oc-release-", dir=target.parent)
            os.close(descriptor)
            prepared[target] = pathlib.Path(temporary)
            if isinstance(value, pathlib.Path):
                shutil.copyfile(value, temporary)
            else:
                prepared[target].write_bytes(value)
            os.chmod(temporary, target.stat().st_mode & 0o777 if target.exists() else 0o644)
        for target in set(desired) | set(stale):
            if target.exists():
                descriptor, temporary = tempfile.mkstemp(prefix=".oc-release-backup-", dir=target.parent)
                os.close(descriptor)
                try:
                    shutil.copy2(target, temporary)
                except BaseException:
                    pathlib.Path(temporary).unlink(missing_ok=True)
                    raise
                backups[target] = pathlib.Path(temporary)
            else:
                backups[target] = None
        for target, temporary in prepared.items():
            os.replace(temporary, target)
        for target in stale:
            target.unlink()
        if sha256(staged) != digest or sha256(destination / filename) != digest:
            raise ValueError("refreshed artifacts differ from verified input")
        for target in (staged.with_name(filename + ".sha256"), destination / (filename + ".sha256")):
            if target.read_bytes() != checksum:
                raise ValueError("refreshed checksum differs from verified input")
    except BaseException:
        for target, backup in backups.items():
            try:
                if backup is None:
                    target.unlink(missing_ok=True)
                else:
                    os.replace(backup, target)
            except OSError:
                rollback_complete = False
                print(f"Recovery required: preserve backup {backup} for {target}", file=sys.stderr)
        raise
    finally:
        if rollback_complete:
            for temporary in list(prepared.values()) + [backup for backup in backups.values() if backup]:
                temporary.unlink(missing_ok=True)
            if created_directory and not any(staged.parent.iterdir()):
                staged.parent.rmdir()
    return version


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--dest", required=True)
    parser.add_argument("--artifact")
    arguments = parser.parse_args()
    print(refresh_release(arguments.source, arguments.dest, arguments.artifact))