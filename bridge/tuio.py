# bridge/tuio.py
"""TUIO 1.1 /tuio/2Dcur encoding. cursors = {session_id: (x, y)} with x,y in [0,1]."""
from pythonosc.osc_message_builder import OscMessageBuilder
from pythonosc.osc_bundle_builder import OscBundleBuilder, IMMEDIATELY

ADDR = "/tuio/2Dcur"

def _msg(*args):
    b = OscMessageBuilder(address=ADDR)
    for a in args:
        b.add_arg(a)
    return b.build()

def build_2dcur_bundle(cursors, fseq, source="videoplaster"):
    bundle = OscBundleBuilder(IMMEDIATELY)
    bundle.add_content(_msg("source", source))
    bundle.add_content(_msg("alive", *list(cursors.keys())))
    for sid, (x, y) in cursors.items():
        # set, s, x, y, X(vel), Y(vel), m(accel)  — velocity/accel zeroed
        bundle.add_content(_msg("set", sid, float(x), float(y), 0.0, 0.0, 0.0))
    bundle.add_content(_msg("fseq", int(fseq)))
    return bundle.build().dgram
