// What the static data says of a type, asked once for a type and kept.
//
// A retail client has the static data in its own files and asks nobody. The page has none of it and asks the
// BFF's copy (GET /api/types/..., POST /api/types/dogma: no call of the server's, and nothing a pilot's session
// can change), and what it is told of a type is so for as long as the page is open. The reads themselves keep
// nothing (app/api.ts): their askers do. Until 2026-10-11 three of the flow's askers kept nothing either. A
// module type's base cycle time was asked for at every reading of the fitting; a combat bot's loadout asked its
// types' facts, and its charges' sizes, at every look (20 times in 20 looks, counted); and a script's mining
// modules' facts were asked for at every start.

/**
 * A reading by key, asked once for a key and kept. `read` answers for the keys it is given with a Map: a key the
 * Map has was answered, whatever its value (null too), and a key it has not was not, and is asked for again
 * another time. Nothing is kept of a reading that failed, and it fails every asker waiting on it. Askers at one
 * time share a reading: a key being read is not asked for again while it is.
 */
export function keptByKey<K, V>(read: (keys: readonly K[]) => Promise<ReadonlyMap<K, V>>): (keys: readonly K[]) => Promise<ReadonlyMap<K, V>> {
  const kept = new Map<K, V>();
  const beingRead = new Map<K, Promise<unknown>>();
  return async (keys) => {
    const wanted = [...new Set(keys)];
    const waits = new Set<Promise<unknown>>();
    for (const key of wanted) {
      const reading = beingRead.get(key);
      if (reading !== undefined) waits.add(reading);
    }
    const unasked = wanted.filter((key) => !kept.has(key) && !beingRead.has(key));
    if (unasked.length > 0) {
      const reading: Promise<unknown> = read(unasked).then((answered) => {
        for (const key of unasked) {
          if (answered.has(key)) kept.set(key, answered.get(key) as V);
        }
      }).finally(() => {
        for (const key of unasked) {
          if (beingRead.get(key) === reading) beingRead.delete(key);
        }
      });
      for (const key of unasked) beingRead.set(key, reading);
      waits.add(reading);
    }
    await Promise.all(waits);
    const known = new Map<K, V>();
    for (const key of wanted) {
      if (kept.has(key)) known.set(key, kept.get(key) as V);
    }
    return known;
  };
}

/** A type's number: a whole number above nought. What is none is passed over, as the static reads pass it over. */
const isTypeID = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

/**
 * A reading of the static data by type, asked once for a type and kept (`keptByKey`). `read` answers by the
 * type's number: a value, null where that is its answer, and nothing for a type it did not answer for. What comes
 * back is what is known of the types asked: a type that was not answered is not among them.
 */
export function keptByType<V>(
  read: (typeIDs: readonly number[]) => Promise<Readonly<Record<number, V>>>,
): (typeIDs: readonly number[]) => Promise<Readonly<Record<number, V>>> {
  const kept = keptByKey<number, V>(async (typeIDs) => {
    const answered = await read(typeIDs);
    const told = new Map<number, V>();
    for (const typeID of typeIDs) {
      const value = answered[typeID];
      if (value !== undefined) told.set(typeID, value);
    }
    return told;
  });
  return async (typeIDs) => {
    const known: Record<number, V> = {};
    for (const [typeID, value] of await kept(typeIDs.filter(isTypeID))) known[typeID] = value;
    return known;
  };
}

/**
 * `keptByType` for a read that answers for every type it is given and leaves out a type the tables do not know
 * (app/api.ts, combatUtilityTypes). Once it has answered, a type it left out is known to be unknown: kept so, not
 * asked for again, and not among what comes back, which is the types the tables know. Fails as the read fails.
 */
export function keptWhereKnown<V>(
  read: (typeIDs: readonly number[]) => Promise<Readonly<Record<number, V>>>,
): (typeIDs: readonly number[]) => Promise<Readonly<Record<number, V>>> {
  const kept = keptByType<V | null>(async (typeIDs) => {
    const answered = await read(typeIDs);
    const told: Record<number, V | null> = {};
    for (const typeID of typeIDs) told[typeID] = answered[typeID] ?? null;
    return told;
  });
  return async (typeIDs) => {
    const known: Record<number, V> = {};
    for (const [typeID, value] of Object.entries(await kept(typeIDs))) {
      if (value !== null) known[Number(typeID)] = value;
    }
    return known;
  };
}

/** A type's attributes by number, as POST /api/types/dogma answers them (app/api.ts, fetchTypeDogma). */
export type TypeAttributes = Readonly<Record<number, Readonly<Record<number, number>>>>;

/**
 * A type's attributes by number, each asked once for a type and kept: its value, or that the type has none of
 * it. `read` answers as the static data's route does: a type it has a row for was answered, an empty row too
 * (the tables have nothing of what was asked), and a type it has no row for was not. What is not known yet is
 * asked for in one reading, by its types and its attributes: a type known for one of them may be asked for it
 * again where another type wants it. What comes back has a row for each type that all the attributes wanted are
 * known for. With no attributes wanted, nothing is asked and nothing known.
 */
export function keptTypeAttributes(
  read: (typeIDs: readonly number[], attributeIDs: readonly number[]) => Promise<TypeAttributes>,
): (typeIDs: readonly number[], attributeIDs: readonly number[]) => Promise<TypeAttributes> {
  // (A key is a type and an attribute; null is "the type has none of it".)
  const pairOf = (key: string): readonly [number, number] => { const [typeID, attributeID] = key.split(":"); return [Number(typeID), Number(attributeID)]; };
  const kept = keptByKey<string, number | null>(async (keys) => {
    const pairs = keys.map(pairOf);
    const rows = await read([...new Set(pairs.map(([typeID]) => typeID))], [...new Set(pairs.map(([, attributeID]) => attributeID))]);
    const told = new Map<string, number | null>();
    for (const [typeID, attributeID] of pairs) {
      const row = rows[typeID];
      if (row !== undefined) told.set(`${typeID}:${attributeID}`, row[attributeID] ?? null);
    }
    return told;
  });
  return async (typeIDs, attributeIDs) => {
    const types = [...new Set(typeIDs.filter(isTypeID))];
    const attributes = [...new Set(attributeIDs.filter(isTypeID))];
    const known = await kept(types.flatMap((typeID) => attributes.map((attributeID) => `${typeID}:${attributeID}`)));
    const rows: Record<number, Record<number, number>> = {};
    for (const typeID of attributes.length > 0 ? types : []) {
      if (!attributes.every((attributeID) => known.has(`${typeID}:${attributeID}`))) continue;
      const row: Record<number, number> = {};
      for (const attributeID of attributes) {
        const value = known.get(`${typeID}:${attributeID}`);
        if (value !== null && value !== undefined) row[attributeID] = value;
      }
      rows[typeID] = row;
    }
    return rows;
  };
}
