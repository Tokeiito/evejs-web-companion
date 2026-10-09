# A type's average price over a week, and how far a price is from it, with the sums in the order the client's code
# does them (a history joined from its two halves, then the average, then the difference), asked of the client's
# own Python 2.7 so that the test has its floats. A row is [day, low, high, average, quantity, orders]. The cases
# are made up; DAY is a day of the clock's 100 ns ticks.
DAY = 864000000000
NOW = 133000000000000000 / DAY * DAY + DAY / 2

def joined(old, new, now):
    history = []
    lastTime = now
    midnightToday = lastTime / DAY * DAY
    lastPrice = 0.0
    for entry in old:
        while lastTime + DAY < entry[0]:
            lastTime += DAY
            history.append([lastTime, lastPrice, lastPrice, lastPrice, 2, 2])
        history.append(entry)
        lastTime = entry[0]
        lastPrice = entry[3]
    while lastTime < midnightToday - DAY:
        lastTime += DAY
        history.append([lastTime, lastPrice, lastPrice, lastPrice, 2, 2])
    if len(new):
        history.extend(new)
    else:
        history.append([now, lastPrice, lastPrice, lastPrice, 0, 0])
    return history

def average(old, new, now, basePrice, portionSize, days=7):
    history = joined(old, new, now)
    averagePrice = -1.0
    volume = 0
    priceVolume = 0.0
    for entry in history:
        if entry[0] < now - days * DAY:
            continue
        priceVolume += entry[3] * entry[4]
        volume += entry[4]
    if volume > 0:
        averagePrice = priceVolume / volume
    else:
        averagePrice = float(basePrice) / portionSize
        if averagePrice <= 0.0:
            averagePrice = 1.0
    return round(float(averagePrice), 2)

def row(daysAgo, price, quantity):
    return [NOW / DAY * DAY - daysAgo * DAY, price * 0.9, price * 1.1, price, quantity, 7]

cases = [
    ("a week of trade and today's", [row(d, 5.0 + d * 0.37, 100 + d * 13) for d in range(10, 1, -1)], [row(1, 6.66, 250)], 2, 1),
    ("gaps in the week", [row(9, 4.2, 10), row(6, 4.95, 1000), row(3, 5.05, 3)], [row(0, 5.5, 77)], 2, 1),
    ("a history that ends a month ago", [row(d, 100.0, 134 + d) for d in range(60, 31, -1)], [row(31, 100.0, 221)], 2, 1),
    ("no new half", [row(d, 12.345, 9) for d in range(4, 0, -1)], [], 2, 1),
    ("a new half alone", [], [row(0, 987.654, 3), row(0, 1000.001, 1)], 2, 1),
    ("nothing at all, by the base price", [], [], 12500, 100),
    ("nothing at all, and no base price", [], [], 0, 1),
    ("a third of a price", [row(2, 1.0 / 3, 3), row(1, 2.0 / 3, 7)], [row(0, 0.125, 5)], 2, 1),
    ("a price at a tie of the hundredths", [row(1, 2.675, 1)], [row(0, 2.675, 1)], 2, 1),
    ("a cheap thing", [row(1, 0.004, 1000)], [row(0, 0.004, 1000)], 2, 1),
]
for name, old, new, basePrice, portionSize in cases:
    avg = average(old, new, NOW, basePrice, portionSize)
    deltas = []
    for price in (0.01, 5.5, 100.0, 987654.32):
        if avg:
            deltas.append(repr((price - avg) / avg))
        else:
            deltas.append("none")
    rows = lambda half: " ".join([";".join(["%d" % each[0]] + [repr(value) for value in each[1:]]) for each in half])
    out("%s|%r|%s|%s|%s|%d|%d" % (name, avg, ",".join(deltas), rows(old), rows(new), basePrice, portionSize))
out("now|%d" % NOW)
