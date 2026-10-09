# Reading the Tranquility recordings

The retail client's own logs of sessions against CCP's server are on the operator's disk
(`D:\SSDSync\EveBadStuff\LOGS`, index in its `LOG_MANIFEST.md`). Every packet is printed there
as a `MarshalStream` repr. These scripts decode those with the server's marshal decoder and
print what was sent and answered, as numbers and states. Nothing of the recordings is kept in
this repository: run them, read the answer, and write down the tally.

`<marshal.js>` is `eve.js/server/src/network/tcp/utils/marshal.js`.

| script | what it prints |
|---|---|
| `decode-lines.js <marshal.js> <file> <from> <to> [filter]` | the transport lines of one file between two line numbers, decoded |
| `object-calls.js <marshal.js> <file> [Method]` | with no method, every method called on each bound object, in order, with how many times; with one, each call of it and what answered, decoded |
| `agent-talks.js <marshal.js> <root>` | every agent `DoAction`: what was pressed (nothing is a fresh talk), the buttons the answer offered, and the last mission change before it; then a tally |
| `agent-talks-where.js <agent-talks output> <root>` | the fresh talks about an accepted mission, by whether the pilot was docked or in space |
| `agent-talks-timeline.js <agent-talks output> <root> <part of a file's name>` | one file's talks in order, among its session changes and mission changes |
| `agent-talks-objectives.js <marshal.js> <agent-talks output> <root>` | each docked fresh talk beside the mission's objectives as the client read them next |
| `agent-talks-empty.js <agent-talks output> <root>` | for each docked fresh talk that got no buttons, which agent's object it was sent to |
| `push-order.js <marshal.js> <root>` | whether each `OnAgentMissionChange` was read before or after the answer to the press that caused it |
| `decline-time.js` | each briefing's "Decline Time" beside the state the mission was in (usage at its top) |

An answer too large is not in a recording: where it should be the log says `LARGE PAYLOAD` and a
size. A pilot's whole skill list is one of those. What a server sends there can then only be worked
out from what the client does with it and from the smaller answers around it, and should be written
down as worked out, not read.

Reading the bytes by eye: a dict entry's value is written before its key; `\x01` is None,
`\x07` is -1, `/\x05` and five bytes is a long.
