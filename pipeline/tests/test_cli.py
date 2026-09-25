import json

import pytest

from fontokmai.cli import main, ssh_command
from fontokmai.contracts.alerts import AlertsFeed
from fontokmai.contracts.manifest import Manifest
from helpers import FIXTURES


def test_cap_snapshot_from_fixtures(tmp_path, capsys):
    args = ["cap-snapshot", "--db", str(tmp_path / "state.db"), "--out", str(tmp_path / "v1"),
            "--fixtures", str(FIXTURES), "--now", "2026-09-25T18:20:00+07:00"]
    assert main(args) == 0
    summary = json.loads(capsys.readouterr().out)
    assert (summary["alerts"], summary["tombstones"], summary["source_status"]) == (3, 6, "ok")
    feed = AlertsFeed.model_validate_json((tmp_path / "v1" / "alerts.json").read_bytes())
    manifest = Manifest.model_validate_json((tmp_path / "v1" / "manifest.json").read_bytes())
    assert feed.generation_id == manifest.generation_id == "20260925T112000Z-local"
    assert (manifest.files[0].path, manifest.completeness) == ("alerts.json", "complete")
    assert main(args) == 0
    assert json.loads(capsys.readouterr().out)["feed_sequence"] == summary["feed_sequence"] == 1


def test_export_schemas_command(tmp_path, capsys):
    assert main(["export-schemas", "--out", str(tmp_path)]) == 0
    assert (tmp_path / "alerts.schema.json").is_file()


def test_schedule_requires_a_work_dir_when_publishing(tmp_path):
    with pytest.raises(SystemExit):
        main(["schedule", "--db", str(tmp_path / "s.db"), "--out", str(tmp_path / "v1"),
              "--publish-remote", "git@github.com:dizconnectz/fontokmai-data.git"])


def test_ssh_command_pins_key_and_known_hosts(tmp_path):
    cmd = ssh_command(tmp_path / "deploy key", tmp_path / "known_hosts")
    assert "-o IdentitiesOnly=yes" in cmd and "-o StrictHostKeyChecking=yes" in cmd
    assert "'" + str(tmp_path / "deploy key") + "'" in cmd
