# bridge/test_tuio.py
from pythonosc.osc_bundle import OscBundle
from tuio import build_2dcur_bundle

def parse(bundle_bytes):
    b = OscBundle(bundle_bytes)
    msgs = []
    for i in range(b.num_contents):
        c = b.content(i)
        msgs.append((c.address, list(c.params)))
    return msgs

def test_bundle_has_alive_set_fseq():
    cursors = {7: (0.25, 0.50), 9: (0.75, 0.10)}
    msgs = parse(build_2dcur_bundle(cursors, fseq=42, source="videoplaster"))
    addrs = [m[0] for m in msgs]
    assert all(a == "/tuio/2Dcur" for a in addrs)
    kinds = [m[1][0] for m in msgs]
    assert "source" in kinds and "alive" in kinds and "fseq" in kinds
    assert kinds.count("set") == 2

def test_alive_lists_all_ids_and_set_carries_xy():
    cursors = {7: (0.25, 0.50)}
    msgs = parse(build_2dcur_bundle(cursors, fseq=1, source="vp"))
    alive = next(m for m in msgs if m[1][0] == "alive")
    assert 7 in alive[1][1:]
    s = next(m for m in msgs if m[1][0] == "set")
    # set, sessionId, x, y, X, Y, m
    assert s[1][1] == 7 and abs(s[1][2]-0.25) < 1e-6 and abs(s[1][3]-0.50) < 1e-6

def test_fseq_value():
    msgs = parse(build_2dcur_bundle({}, fseq=99, source="vp"))
    fseq = next(m for m in msgs if m[1][0] == "fseq")
    assert fseq[1][1] == 99
