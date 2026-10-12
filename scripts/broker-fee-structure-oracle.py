# The broker's fee rate in a structure, with the sums in the order the client's code does them, asked of the
# client's own Python 2.7 so that the test has its floats and not ones of my own making: what it makes of a tax
# that is True or None is the interpreter's to say. The cases are made up.
#
# A structure's base is its own market tax, a percentage (marketsvc.py 229 to 239); no skill applies there
# (marketsvc.py 242, skilllimits.py 25 to 33); with no base there is no rate (marketsvc.py 165); the system's
# upgrade takes a tenth off for each level (facwarCommon.py 200 to 202); and a structure's owner has no standing
# that counts (marketsvc.py 745 to 752, brokerFee.py 68 to 70).
def rate(base, level):
    fee = None
    if base is not None:
        fee = base / 100.0
    if not fee:
        return 0.0
    fee = fee * (1 - 0.1 * level)
    fee = fee - 0.0 * 0.0003 - 0.0 * 0.0002
    return fee

for base in (None, True, False, 0, 0.0, 1, 1.0, 2.5, 3, 5.75, 7.3, 10, 11.5, 0.1):
    for level in (0, 2, 5):
        out("%r %d %r" % (base, level, rate(base, level)))
