import subprocess

import pytest

from fontokmai.publish.git_pages import PublishError, publish_snapshot


def _bare(tmp_path):
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "-q", "--bare", str(bare)], check=True)
    return bare


def _git(bare, *args):
    return subprocess.run(["git", "--git-dir", str(bare), *args], capture_output=True, text=True, check=True).stdout


def _snapshot(tmp_path, manifest):
    src = tmp_path / "out"
    src.mkdir(exist_ok=True)
    (src / "manifest.json").write_text(manifest, encoding="utf-8")
    (src / "alerts.json").write_text("{}", encoding="utf-8")
    (src / ".alerts.json.tmp123").write_text("partial", encoding="utf-8")
    return src


def test_publish_replaces_the_branch_with_one_commit(tmp_path):
    bare = _bare(tmp_path)
    publish_snapshot(_snapshot(tmp_path, '{"g":1}'), tmp_path / "work", str(bare), message="g1")
    commit = publish_snapshot(_snapshot(tmp_path, '{"g":2}'), tmp_path / "work", str(bare), message="g2")
    assert _git(bare, "log", "--format=%H %s", "gh-pages").split() == [commit, "g2"]
    files = _git(bare, "ls-tree", "-r", "--name-only", "gh-pages").split()
    assert files == [".nojekyll", "data/v1/alerts.json", "data/v1/manifest.json", "index.html"]
    assert _git(bare, "show", "gh-pages:data/v1/manifest.json") == '{"g":2}'


def test_refuses_a_snapshot_without_manifest(tmp_path):
    src = tmp_path / "empty"
    src.mkdir()
    with pytest.raises(PublishError, match="no manifest.json"):
        publish_snapshot(src, tmp_path / "work", str(_bare(tmp_path)), message="x")
