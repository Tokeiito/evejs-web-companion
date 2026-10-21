"use strict";

/** StateManager.Prime2399-2419 and its three notice receivers1307/1342/1441.
 * This is the receive/send boundary only, not a general event dispatcher.
 * A failed Prime body clears priming but retains its channel and receivers.
 */
function createGodmaPrimeChannel() {
  let priming = false;
  let channel = null;
  function begin() {
    priming = true;
    channel = [];
  }
  function finishBody() { priming = false; }
  function receive(work) {
    if (channel === null) return work();
    return new Promise(resolve => channel.push(resolve)).then(work);
  }
  async function release() {
    // The installed Stackless channel prefers the receiver (-1). Give each
    // receiver its turn before the next send, without awaiting its work.
    // Read the current channel on every turn, just as Prime does.
    while (channel.length) {
      channel.shift()(true);
      await Promise.resolve();
    }
    channel = null;
  }
  return {
    begin, finishBody, receive, release,
    state: () => ({ priming, channel: channel !== null, receivers: channel?.length ?? 0 }),
  };
}

module.exports = { createGodmaPrimeChannel };
