# The broker's fee rate at an NPC station, with the sums in the order the client's code does them, asked of the
# client's own Python 2.7 so that the test has its floats and not ones of my own making. The four numbers are the
# game's constants; the cases are made up.
def rate(broker, faction, corp, level):
    tax = 3.0 / 100.0
    tax -= broker * 0.3 / 100
    if not tax:
        return 0.0
    tax = tax * (1 - 0.1 * level)
    tax = tax - faction * 0.0003 - corp * 0.0002
    return tax

for broker in (0, 1, 3, 4, 5):
    for faction, corp in ((0.0, 0.0), (0.0, 2.1), (1.25, 0.0), (5.03, 7.77), (-2.5, -9.99), (10.0, 10.0), (0.105, 3.3333)):
        for level in (0, 2, 5):
            out("%d %r %r %d %r" % (broker, faction, corp, level, rate(broker, faction, corp, level)))
