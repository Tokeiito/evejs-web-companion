# Destiny ballpark: porting reference for the game-port web client

Written 2026-10-08 from a read of two source trees. Nothing here was taken from memory of EVE; where the
source did not settle a point it says **NOT DETERMINED** and names what was read.

**How far to trust it.** A sub-agent of the game-port loop wrote this as a map for the port; the port is
made from the source itself, and each section is checked against the code it cites when that part is
ported. Checked so far:

- 1.2, 1.3 and all of section 2, against the source and against a real server's bytes
  (`src/gamePort/destiny/state.js`, `test/destinyState.test.js`).
- 4.1 to 4.7 (the tick, the integrator, STOP, GOTO, FOLLOW, the old-style orbit) and the orders and
  setters they use, against the source and against CCP's own per-tick fixtures to the last digit
  (`src/gamePort/destiny/ballpark.js`, `test/destinyBallpark.test.js`).

One correction found on the way: the note in 4.2 about evaluation order holds, but committing balls
one at a time instead of together cannot be told apart by FOLLOW, since every acceleration is found
before any ball moves. Only collisions (section 5), worked out during the stepping pass, can tell.

Everything else is as written, unchecked.

## 0. Conventions, sources, and the three switches that change everything

Citations are `repo:path:line`.

| Prefix | Repo | What it is |
| --- | --- | --- |
| `D:` | `C:\Users\ryanf\Documents\GitHub\destiny` (HEAD `5d7b818`) | CCP's open-sourced destiny, C++ and its Python package |
| `C:` | `C:\Users\ryanf\Documents\GitHub\eve.js\tools\ClientCodeGrabber\Latest` | Decompiled Python of the retail client (build 3396210) |
| `E:` | `C:\Users\ryanf\Documents\GitHub\eve.js` | The emulator. Used only as a cross-check, always labelled |

Two things about the decompiled client that matter when checking these notes:

- `michelle.py` has constant sets the decompiler could not resolve; they print as integers
  (`C:eve/client/script/remote/michelle.py:816-839`, `:72-83`, `:780-790`). The strings below were recovered
  from the constant tables of `C:eve/client/script/remote/michelle.pyc` (code objects `Michelle`, `Park`,
  `Park.__init__`). The integers in the `.py` are indices into those tables.
- The decompiler mis-rendered the control flow of `Park.RealFlushState`
  (`C:eve/client/script/remote/michelle.py:1164-1186`). The bytecode was disassembled to settle it; see 6.3.

### 0.1 Global settings (compile-time defaults, changeable at run time)

Destiny has five process-wide settings. Three of them select entirely different code paths for
integration, orbit and collision, and one changes the binary state layout.

```cpp
constexpr size_t g_collisionMaxIterationsDefault = 20;
constexpr bool g_useIterativeCollisionDefault = false;
constexpr bool g_useDynamicalOrientationDefault = false;
constexpr bool g_disableDynamicalOrientationForMissilesDefault = false;
constexpr bool g_useNewOrbitDefault = false;
```
`D:src/Settings.h:9-13`

They are changed only through `destiny.settings.Apply(config)` and `destiny.settings.Reset()`
(`D:src/Settings.cpp:13-33`, `:57-65`; `D:src/Settings_Blue.cpp:13-16`, `:66`).

In the retail client's Python the only code that touches `destiny.settings` is the helper module itself
(`C:destiny/_util.py:8-36`); a search of every `.py` under `C:` for `enable_dynamical_orientation`,
`enable_new_orbit`, `useDynamicalOrientation`, `useNewOrbit`, `useIterativeCollision`,
`SettingsConfiguration` and `destiny.settings` finds no caller outside that file.

**NOT DETERMINED:** the values these three flags have inside the retail `_destiny` binary. What was looked at:
the open-source defaults (all false), the absence of any Python caller in the client, and one indirect
check: the emulator writes no rotation fields in its free-ball records (`E:server/src/space/destiny/stream/ballEncoding.js:487-519`)
and the retail client reads them, which is only possible if `g_useDynamicalOrientation` is false when the
client parses a state (see 2.3). There is no equivalent evidence for `g_useNewOrbit` or
`g_useIterativeCollision`. **The rest of this document describes the all-false configuration as the
primary path** and flags every place where a true value would change the result.

**NOT DETERMINED:** whether the open-source revision is the revision compiled into build 3396210. What was
looked at: the client's own `destiny` Python package is line-for-line the same logic as the open-source one
(`C:destiny/net/client/_ticker.py` against `D:python/destiny/net/client/_ticker.py`), which says the two are
close, but the DLL itself was not inspected.

### 0.2 What was checked by calculation

To test the transcription of the equations in section 4, the expected values in six test fixtures were
recomputed by hand-evaluating the quoted C++ in IEEE-754 double arithmetic (throwaway calculation, not
kept). All matched **bit for bit**, every digit of every component:

| Fixture | Rows checked | Exercises |
| --- | --- | --- |
| `D:python/destiny/test/ballpark/evolve/test_goto.py:21-32` | 1-3 | `GotoThrust`, `Integrate`, time factor |
| `D:python/destiny/test/ballpark/evolve/test_goto.py:47-66` | 16-18 | the "homing" branch of `GotoThrust` |
| `D:python/destiny/test/ballpark/evolve/test_stop.py:29-40` | 1-3 | `EvolveStop` Y-damping, friction decay |
| `D:python/destiny/test/ballpark/evolve/test_orbit.py:24-35` | 1-4 | `EvolveOldStyleOrbit` |
| `D:python/destiny/test/ballpark/evolve/test_follow.py:116-127` | 1-3 | `EvolveFollow` against a moving leader |
| `D:python/destiny/test/ballpark/evolve/test_warp.py:28-39` | 1-3 | warp alignment phase |

That result depends on four rules, all stated again where they apply: the `float` fields are rounded to
float32 before use; vector division is multiplication by a reciprocal; `Integrate` is evaluated exactly
as written with no algebraic simplification; no fused multiply-add. The collision code (section 5), the
warp cruise and deceleration formulas, and the interpolation code were **not** checked this way.

---

## 1. Data model

Repo for this section: `D:` unless marked.

### 1.1 Scalar types

| Name | Definition | Citation |
| --- | --- | --- |
| `ID` | `typedef int64_t ID;` | `D:src/Partitionable.h:12`, `D:src/Ball.h:74` |
| `Vector3d` | three `double`, `x,y,z`, no virtuals (24 bytes) | `D:src/Vector3d.h:9`, `:86` |
| `Vector3`, `Quaternion` | float32 types from CCP's math library (not in this repo); used only for orientation and for the values handed to rendering | `D:src/Vector3d.h:22` |
| `Be::Time` | 64-bit time. `mTickInterval*10000` converts milliseconds to it, so one unit is 100 ns | `D:src/Ballpark.cpp:235`, `D:src/Ball.cpp:1324` |
| `long` | `mCurrentTime`, `mEffectStamp`, bubble ids. Serialised as `int32_t` | `D:src/Ballpark.h:88`, `D:src/Partitionable.h:40`, `D:src/Thunkers.cpp:2161`, `:3252` |

`AU` is `const double AU = .1495978707e12;` (`D:src/Ballpark.h:31`). The client constant has the same value,
`AU = 149597870700.0` (`C:eve/common/lib/appConst.py:39`).

### 1.2 Ball modes

```cpp
enum DSTBALLMODE
{
	DSTBALL_GOTO,
	DSTBALL_FOLLOW,
	DSTBALL_STOP,
	DSTBALL_WARP,
	DSTBALL_ORBIT,
	DSTBALL_MISSILE,
	DSTBALL_MUSHROOM,
	DSTBALL_BOID,
	DSTBALL_TROLL,
	DSTBALL_MINIBALL,	
	DSTBALL_FIELD,
	DSTBALL_RIGID,
	DSTBALL_FORMATION
};
```
`D:src/IDstConstants.h:11-26`

| Value | Name | Value | Name |
| --- | --- | --- | --- |
| 0 | GOTO | 7 | BOID |
| 1 | FOLLOW | 8 | TROLL |
| 2 | STOP | 9 | MINIBALL |
| 3 | WARP | 10 | FIELD |
| 4 | ORBIT | 11 | RIGID |
| 5 | MISSILE | 12 | FORMATION |
| 6 | MUSHROOM | | |

Note MINIBALL is 9 and FIELD is 10: the registration table in `D:src/DstConstants.h:89-98` lists FIELD before
MINIBALL, but the numeric values come from the enum. The client hard-codes `DESTINY_MODE_ORBIT = 4`
(`C:eve/client/script/remote/michelle.py:35`).

The modes that use `mFollowId`/`mFollowPtr`:
```cpp
extern const std::array<int,4> followModes = {DSTBALL_FOLLOW, DSTBALL_ORBIT, DSTBALL_MISSILE, DSTBALL_FORMATION};
```
`D:src/Ballpark.cpp:68`

### 1.3 Ball flags

The flags are separate `bool` members in memory. They are packed into one byte only in the serialised
state (section 2):

```cpp
enum BALLFLAGS
{
	DSTBALL_ISFREE        = 0x00000001,
	DSTBALL_ISGLOBAL      = 0x00000002,
	DSTBALL_ISMASSIVE     = 0x00000004,
	DSTBALL_ISINTERACTIVE = 0x00000008,
	DSTBALL_ISSPACEJUNK   = 0x00000010,
	DSTBALL_HASMINIBOXES  = 0x00000020,
	DSTBALL_HASMINIBALLS  = 0x00000040,
	DSTBALL_HASMINICAPSULES  = 0x00000080
};
```
`D:src/IDstConstants.h:35-45`

The harmonic is **not** a flag. It is a 64-bit field, `int64_t mHarmonic` (`D:src/Ball.h:101`), default -1.

Other constants: `DSTLOCALBALLS = -1073741824`, `DSTNORMALCLOAK = 1`, `DSTRESTORECLOAK = 2`,
`DSTGMCLOAK = 3` (`D:src/IDstConstants.h:74-80`). `DESTINYPACKETS`: `DESTINY_FULLSTATE = 0`,
`DESTINY_BALLS = 1` (`D:src/IDstConstants.h:28-32`).

### 1.4 Ball fields

Defaults are from the constructors: `D:src/Ball.cpp:61-118` (Ball), `D:src/Partitionable.cpp:6-15`
(Partitionable base), `D:src/Ball.cpp:33-59` (ClientBall). A `Vector3d` with no initialiser is `(0,0,0)`
(`D:src/Vector3d.h:12`).

**Identity and partition base** (`D:src/Partitionable.h:27-41`)

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `mId` | `ID` | 0 | ball id |
| `mNewPos` | `Vector3d` | `(1e10,1e10,1e10)` (`D:src/Ball.cpp:114`) | position at the latest tick |
| `mOldPos` | `Vector3d` | `(0,0,0)` | position one tick earlier |
| `mNewBubble`, `mOldBubble` | `long` | -1 | bubble ids. Only a master (server) park assigns them; see 5.4 |
| `isInteractive` | `bool` | false | "true if ball is associated with a user" |
| `mEffectStamp` | `long` | 0 | overloaded tick stamp; see below |
| `isMoribund` | `bool` | false | removed but not yet freed; skipped by the simulation |

`mEffectStamp` means different things by mode:

| Mode | Meaning | Citation |
| --- | --- | --- |
| WARP, aligning | negative; starts at -1 and is decremented once per tick spent aligning | `D:src/Ballpark.cpp:4125`, `:943` |
| WARP, warping | the `mCurrentTime` at which warp proper began (0 or more) | `D:src/Ballpark.cpp:4160` |
| MISSILE | launch tick | `D:src/Ballpark.cpp:3865` |
| FORMATION | formation slot index | `D:src/Ballpark.cpp:3996` |
| MUSHROOM | creation tick | `D:src/Ballpark.cpp:3787` |
| TROLL | tick at which it petrifies | `D:src/Ballpark.cpp:6311` |
| moribund | tick at which it is finally removed | `D:src/Ballpark.cpp:5537` |

**Distributed state** (`D:src/Ball.h:99-168`)

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `mFollowId` | `ID` | 0 | followed ball for FOLLOW, ORBIT, MISSILE, FORMATION. **In WARP it holds the raw bits of the `double` minimum range** (`D:src/Ballpark.cpp:4128-4130`) |
| `mOwnerId` | `ID` | 0 | missile launcher (negative marks a defender missile, `D:src/Ballpark.cpp:632-633`), mushroom owner, miniball parent. **In WARP it holds the integer warp factor** (`D:src/Ballpark.cpp:4132-4133`) |
| `mHarmonic` | `int64_t` | -1 | force-field harmonic |
| `mAllianceID`, `mCorporationID` | `int32_t` | -1 | used only by the force-field collision filter |
| `mFormationID` | `char` | -1 | formation this ball leads |
| `isCloaked` | `uint8_t` | 0 | 0, or a cloak mode 1/2/3 |
| `isFree` | `bool` | false | "true if ball can move"; only free balls are evolved |
| `isGlobal` | `bool` | false | visible from every bubble |
| `isMassive` | `bool` | false | "true if ball is solid"; gates collisions |
| `isSpaceJunk` | `bool` | false | collision filter |
| `mRadius` | `float` | 0.0 | metres |
| `mMaxVel` | `float` | 0.0 | m/s |
| `mAgility` | `float` | 1.0 | multiplies mass in every dynamics formula |
| `mSpeedFraction` | `float` | 1.0 | cruise speed as a fraction of `mMaxVel` |
| `mFollowRange` | `float` | 10.0 | follow/orbit range, surface to surface |
| `mMass` | `double` | 0.0 | kg |
| `mTimeFactor` | `double` | 1.0 | cached `exp(-friction*dt/(mass*agility))`; see 4.3 |
| `mLastCollision` | `double` | -1.0 | fraction of the tick at which the chosen collision happens. **In WARP it holds the total warp distance** (`D:src/Ballpark.cpp:4161`) |
| `mNewVel`, `mOldVel` | `Vector3d` | 0 | velocity now and one tick earlier |
| `mGoto` | `Vector3d` | 0 | goto point; rewritten every tick by FOLLOW, ORBIT, MISSILE, FORMATION |
| `mLastG` | `Vector3d` | 0 | acceleration from the ball's own mode, this tick |
| `mLastC` | `Vector3d` | 0 | acceleration from collision response, this tick |
| `mMode` | `DSTBALLMODE` | STOP | |
| `mFollowPtr` | `Ball*` | 0 | resolved `mFollowId` |
| `mFollowers` | set of `ID` | empty | balls following this one |
| `mNewTime`, `mOldTime` | `Be::Time` | 0 | sim-clock stamps of the last two ticks; interpolation only |
| `mMiniBalls`, `mMiniBoxes`, `mMiniCapsules` | lists | empty | collision sub-shapes of a fixed ball |

Old-style orientation state (used when dynamical orientation is off): `mNewYaw`, `mOldYaw`, `mNewPitch`,
`mOldPitch`, `mNewRoll`, `mOldRoll`, `mNewRollSpeed`, `mOldRollSpeed`, `mYawDelta`, all `double`, all 0
(`D:src/Ball.h:140-148`). Dynamical orientation state: `mNewRot`/`mOldRot` (identity quaternion),
`mNewAngVel`/`mOldAngVel` (zero), `mMaxAngVel` float 1.0, `mRotAgility` float 0.9, `mRoll`, `mTorque`
(`D:src/Ball.h:129-166`, defaults `D:src/Ball.cpp:77-83`).

Proximity bookkeeping (events only, no effect on motion): `mSensor`, `mNotificationRange`,
`mTrackingPtr`, `mTrackingRange`, `mWithinRange`, `mWithinTrackingRange`, `mHasProximity`
(`D:src/Ball.h:104`, `:119-121`, `:139`, `:149`, `:189`).

**ClientBall additions** (`D:src/Ball.h:411-454`). The client creates `ClientBall`, the server `Ball`
(`D:src/Ballpark.cpp:3336-3343`).

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `mLastPos`, `mLastVel` | `Vector3d` | 0 | last interpolated position and velocity |
| `mDeltaPos` | `Vector3d` | 0 | movement between the last two interpolations |
| `mPosUpdateTime`, `mRotUpdateTime` | `Be::Time` | 0 | time of the last interpolation (already shifted; see 7.1) |
| `mElapsed` | `double` | 0.0 | seconds interpolated since the last tick change |
| `mCenterDist` | `double` | -1.0 | cached centre distance from ego; see 7.3 |
| `mLastTick` | `long` | -1 | `mCurrentTime` at the last interpolation |
| `mIntAcc` | `Vector3d` | 0 | copy of `mLastC+mLastG`; written, never read in this repo (`D:src/Ball.cpp:899`) |

### 1.5 Ballpark fields

Declarations `D:src/Ballpark.h:84-150`; defaults `D:src/Ballpark.cpp:86-121`.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `mTime` | `Be::Time` | 0 | sim-clock time of the last tick boundary |
| `mTickInterval` | `int` | 1000 | milliseconds per tick |
| `dt` | `double` | `mTickInterval * 0.001` | seconds per tick. Recomputed only in `OnTick` (`D:src/Ballpark.cpp:120`, `:244`) |
| `mCurrentTime` | `long` | 0 | the tick counter; this is what a "stamp" is compared against |
| `mFriction` | `double` | 1000000.0 | "Friction coefficient of space" |
| `mEgo` | `ID` | 0 | the viewer's own ball |
| `isMaster` | `bool` | false | true on a server. Set by the constructor argument (`D:src/Thunkers.cpp:38-46`) |
| `mFirstTime` | `bool` | true | first `OnTick` not yet seen |
| `mHaveTicks` | `bool` | false | registered for engine ticks (`isRunning` in Python) |
| `inEvolve` | `bool` | false | guards removal and addition during a step |
| `mLocalCnt` | `ID` | -1 | generator for server-made non-item ids |
| `mLocalHiCnt` | `ID` | `DSTLOCALBALLS` | generator for local ids (miniballs); decrements |
| `mBalls`, `mGlobals` | Python dicts id to ball | empty | `balls`, `globals` in Python |
| `mFreeBalls` | `std::map<ID, Ball*>` | empty | **ordered by id**; the iteration order of every loop in `Evolve` (`D:src/Ballpark.h:60`) |
| `mProximityBalls` | unordered map | empty | balls with a sensor |
| `moribundBalls` | set | empty | awaiting removal |
| `mFormations` | vector of vector of `Vector3d` | empty | loaded from `beyonce.GetFormations()` (`C:eve/client/script/remote/michelle.py:324-325`) |
| `mPartition` | `Partition*` | new | spatial partition; section 5 |
| `mMoribundBallRemovalCount`, `mMoribundBallRemovalBuffer` | `int` | 7, 2 | throttle for early removal of moribund balls |
| `mRollSpeedAcceleration`, `mRollSpeedDecay`, `mRollAcceleration`, `mRollDecay` | `double` | -3.0, -0.9, 1.0, -0.5 | old-style roll animation |
| `mSomeWeirdHackToFixSomething` | `float` | 1.0 | divisor applied to the rendered position of global balls (`D:src/Ball.cpp:1403-1408`) |
| `mLastReference`, `mOldReference`, `mLastDelta`, `mLastReferenceTime` | | -1 for the time | cache of the ego's interpolated position |

`mWarpSpeed` (2.0), `mLagDamping` (0.1), `mPara1`, `mPara2`, `mInt1`, `mInt2`, `mSolarsystemID` are set
in the constructor and exposed to Python but are not read anywhere else in `D:src/*.cpp`.

The retail client never sets `isMaster` or `friction` on the park: a search of `C:` for `.isMaster` and
`.friction` finds only UI and camera code. So on the client `isMaster` is false and `mFriction` is 1e6.
The client sets `tickInterval` to `const.simulationTimeStep`, which is 1000
(`C:eve/client/script/remote/michelle.py:799`, `C:eve/common/lib/appConst.py:1525`).

### 1.6 Names as Python sees them

The client reads ball state through these attribute names (`D:src/Ball_Blue.cpp:19-478`):

| Python | Member | Python | Member |
| --- | --- | --- | --- |
| `id` | `mId` | `mode` | `mMode` (read-only) |
| `x`, `y`, `z` | `mNewPos` | `gotoX`, `gotoY`, `gotoZ` | `mGoto` |
| `vx`, `vy`, `vz` | `mNewVel` | `followId` | `mFollowId` (read-only) |
| `mass` | `mMass` | `followRange` | `mFollowRange` (read-only) |
| `radius` | `mRadius` | `ownerId` | `mOwnerId` |
| `maxVelocity` | `mMaxVel` | `effectStamp` | `mEffectStamp` (read-only) |
| `Agility` (capital A) | `mAgility` | `speedFraction` | `mSpeedFraction` |
| `isFree`, `isGlobal`, `isMassive`, `isInteractive`, `isCloaked`, `isMoribund` | same | `yaw`, `pitch`, `roll` | `mNewYaw`, `mNewPitch`, `mNewRoll` |
| `harmonic`, `corporationID`, `allianceID` | | `newBubbleId`, `oldBubbleId` | |
| `centerDist`, `surfaceDist` (ClientBall) | computed; see 7.3 | `ballpark` | `mPark` |

Assigning a writable attribute from Python does not just store the value. The attributes are registered
with `Be::NOTIFY`, and `Ball::OnModified` routes each one to the matching ballpark method: `x`/`y`/`z` to
`SetBallPosition`, `vx`/`vy`/`vz` to `SetBallVelocity`, `gotoX`/`gotoY`/`gotoZ` to `GotoPoint`, `radius`
to `SetBallRadius`, `maxVelocity` to `SetMaxSpeed`, `mass` to `SetBallMass`, `isFree` to `SetBallFree`,
`isMassive` to `SetBallMassive`, `isGlobal` to `SetBallGlobal`, `Agility` to `SetBallAgility`,
`speedFraction` to `SetSpeedFraction`, `harmonic`/`corporationID`/`allianceID` to `SetBallHarmonic` with
field = 0 (`D:src/Ball.cpp:1507-1631`). The client uses this to move its own client-side balls
(`C:eve/client/script/remote/michelle.py:1293-1297`).

---

## 2. The full-state blob

Repo for this section: `D:` unless marked. Reader: `Ballpark::PyReadFullStateFromStream`
(`D:src/Thunkers.cpp:2083-2143`), `Ballpark::ReadFullStateFromStream` (`:2463-2507`),
`Ballpark::ReadBallFromStream` (`:2897-3178`). Writers: `PyWriteFullStateToStream` (`:2145-2200`),
`PyWriteBallsToStream` (`:2202-2257`), `WriteBallToStream` (`:3180-3377`).

### 2.1 Who carries one

One format serves four uses. In every case the client hands the bytes to the same C++ reader.

| Carrier | Client call | `partial` | Citation |
| --- | --- | --- | --- |
| `SetState` (`bag.state`) | `self._parent_ReadFullStateFromStream(ms)` | 0 | `C:eve/client/script/remote/michelle.py:973-975` |
| `AddBalls` (`chunk[0]`) | `self._parent_ReadFullStateFromStream(ms, 2)` | 2 | `C:eve/client/script/remote/michelle.py:1235-1239` |
| `AddBalls2` (`chunk[0]`) | `self._parent_ReadFullStateFromStream(ms, 2)` | 2 | `C:eve/client/script/remote/michelle.py:1256-1260` |
| client's own rewind snapshot | `self._parent_ReadFullStateFromStream(lastState, 1)` | 1 | `C:eve/client/script/remote/michelle.py:1089` |

### 2.2 Encoding rules

- **No version byte, no ball count, no length.** There is a one-byte packet type, a four-byte tick stamp,
  and then ball records until the stream ends.
- Every field is written by copying the in-memory object: `s->Write(&x, sizeof(x))`
  (`D:src/Thunkers.cpp:3218-3222`). So the byte order is the host's (little-endian on x86-64), integers
  are two's complement, `float` is IEEE-754 binary32 and `double` is binary64. The emulator writes
  little-endian and the retail client accepts it (`E:server/src/space/destiny/stream/primitives.js:117`,
  `:139`, `:145`).
- There is no padding between fields; each is a separate `Write`.

### 2.3 Header

| Offset | Size | Type | Field | Citation |
| --- | --- | --- | --- | --- |
| 0 | 1 | `char` | packet type: 0 `DESTINY_FULLSTATE`, 1 `DESTINY_BALLS` | `D:src/Thunkers.cpp:2162`, `:2223` |
| 1 | 4 | `int32_t` | tick stamp: the writer's `mCurrentTime` | `D:src/Thunkers.cpp:2161`, `:2222` |

The reader loop:

```cpp
	sp->Seek(0, ICcpStream::SO_BEGIN);
	while((tmpCnt = sp->Read(&packet,1)) > 0)
	{
		byteCount += tmpCnt;
		switch(packet)
		{
		case DESTINY_FULLSTATE:
		case DESTINY_BALLS:
			{
				errorCondition = ReadFullStateFromStream(sp, partial);
				break;
			}
		default:
			{
				PyErr_SetString(PyExc_ValueError, "Unknown packet type");
				return 0;
			}
		}
```
`D:src/Thunkers.cpp:2113-2130`

The two packet types are read identically. What differs between a full state and an addition is the
`partial` argument the caller passes, not the packet byte:

```cpp
	if(!partial)
	{
		mFreeBalls.clear();
		mProximityBalls.clear();
		if(bubbleInteractives)
			PyDict_Clear(bubbleInteractives);
	}
```
`D:src/Thunkers.cpp:2102-2108`

Then the stamp, and balls until a read returns nothing:

```cpp
	int32_t timestamp;

	byteCount += s->Read(&timestamp,sizeof(timestamp));

	mCurrentTime = timestamp;
	Ball *ball;
	VectorOfBalls l;
	while( ( ball = ReadBallFromStream(s, partial) ) )
	{
		l.push_back(ball);
	}
```
`D:src/Thunkers.cpp:2465-2475`

**Every read sets `mCurrentTime`**, including an `AddBalls`/`AddBalls2` (`partial` = 2) and a rewind.
A blob whose stamp differs from the tick the client had synchronised to moves the client's clock.

Byte fixtures: an empty balls packet at tick 0 is `b"\x01\x00\x00\x00\x00"` and an empty full state is
`b"\x00\x00\x00\x00\x00"` (`D:python/destiny/test/ballpark/test_stream_read_write.py:12`, `:65`).

Because the inner loop consumes the stream to its end, a stream holds one packet in practice. A ball
record whose mode byte is not one of the handled values makes `ReadBallFromStream` return 0
(`D:src/Thunkers.cpp:3104-3109`), which ends the ball loop early; the outer loop then reads the next
byte of that record as a packet type.

### 2.4 Ball record: fixed part, in read order

```cpp
		byteCount += s->Read(&mode           , sizeof(mode));
		byteCount += s->Read(&radius         , sizeof(radius));
		byteCount += s->Read(&pos.x          , sizeof(Vector3d));
		byteCount += s->Read(&flags          , sizeof(flags));

		if(mode!=DSTBALL_RIGID)
		{
			byteCount += s->Read(&mass           , sizeof(mass));
			byteCount += s->Read(&isCloaked      , sizeof(isCloaked));
			byteCount += s->Read(&harmonic       , sizeof(harmonic));
			byteCount += s->Read(&corporationID  , sizeof(corporationID));
			byteCount += s->Read(&allianceID     , sizeof(allianceID));
		}

		if(flags & DSTBALL_ISFREE)
		{
			byteCount += s->Read(&maxVel,sizeof(maxVel));
			byteCount += s->Read(&vel.x,sizeof(Vector3d));
			byteCount += s->Read(&agility,sizeof(agility));
			byteCount += s->Read(&speedFraction,sizeof(speedFraction));
			if( g_useDynamicalOrientation )
			{
				byteCount += s->Read( &rot.x, sizeof( Quaternion ) );
				byteCount += s->Read( &maxAngVel, sizeof( maxAngVel ) );
				byteCount += s->Read( &angVel.x, sizeof( Vector3 ) );
				byteCount += s->Read( &rotAgility, sizeof( rotAgility ) );
			}
		}
```
`D:src/Thunkers.cpp:2924-2951` (the id is read just before, at `:2902`)

| # | Size | Type | Field | Present when | Default if absent (`D:src/Thunkers.cpp:2904-2920`) |
| --- | --- | --- | --- | --- | --- |
| 1 | 8 | `int64` | `id` | always | |
| 2 | 1 | `uint8` | `mode` | always | |
| 3 | 4 | `float32` | `radius` | always | |
| 4 | 24 | 3 x `float64` | `pos.x, pos.y, pos.z` | always | |
| 5 | 1 | `uint8` | `flags` (1.3) | always | |
| 6 | 8 | `float64` | `mass` | `mode != 11` (RIGID) | `1.0e34` |
| 7 | 1 | `int8` | `isCloaked` | `mode != 11` | 0 |
| 8 | 8 | `int64` | `harmonic` | `mode != 11` | -1 |
| 9 | 4 | `int32` | `corporationID` | `mode != 11` | -1 |
| 10 | 4 | `int32` | `allianceID` | `mode != 11` | -1 |
| 11 | 4 | `float32` | `maxVel` | `flags & 0x01` | 0.0 |
| 12 | 24 | 3 x `float64` | `vel.x, vel.y, vel.z` | `flags & 0x01` | 0 |
| 13 | 4 | `float32` | `agility` | `flags & 0x01` | 1.0 |
| 14 | 4 | `float32` | `speedFraction` | `flags & 0x01` | 0.0 |
| 14a | 16 | 4 x `float32` | `rot`, starting at `.x` | `flags & 0x01` **and** dynamical orientation | identity |
| 14b | 4 | `float32` | `maxAngVel` | same | 0.0 |
| 14c | 12 | 3 x `float32` | `angVel` | same | 0 |
| 14d | 4 | `float32` | `rotAgility` | same | 1.0 |
| 15 | 1 | `int8` | `formationID` | always | |

Field 15 is read after the ball has been created (`D:src/Thunkers.cpp:2986-2988`). -1 is "no formation",
which is the byte `0xff`; the emulator always writes `0xff` there
(`E:server/src/space/destiny/stream/ballEncoding.js:519`).

The member order inside `Quaternion` is **NOT DETERMINED** from this repo (the type is in CCP's math
library); the reader starts at `&rot.x` and reads `sizeof(Quaternion)`. It only matters with dynamical
orientation on.

### 2.5 Ball record: the per-mode tail

Read immediately after `formationID`. Quoted in full because the order matters:

```cpp
		case DSTBALL_FOLLOW:
			{
				byteCount += s->Read(&ball->mFollowId,    sizeof(ball->mFollowId)    );
				byteCount += s->Read(&ball->mFollowRange, sizeof(ball->mFollowRange) );
				break;
			}
		case DSTBALL_FORMATION:
			{
				byteCount += s->Read(&ball->mFollowId,    sizeof(ball->mFollowId)    );
				byteCount += s->Read(&ball->mFollowRange, sizeof(ball->mFollowRange) );
				byteCount += s->Read(&effectStamp, sizeof(effectStamp) );
				ball->mEffectStamp = effectStamp;
				break;
			}
		case DSTBALL_MISSILE:
			{
				byteCount += s->Read(&ball->mFollowId,    sizeof(ball->mFollowId)    );
				byteCount += s->Read(&ball->mFollowRange, sizeof(ball->mFollowRange) );
				byteCount += s->Read(&ball->mOwnerId,     sizeof(ball->mOwnerId)     );
				byteCount += s->Read(&effectStamp, sizeof(effectStamp) );
				ball->mEffectStamp = effectStamp;
				byteCount += s->Read(&ball->mGoto.x,         sizeof(ball->mGoto)           );
				break;
			}
		case DSTBALL_ORBIT:
			{
				byteCount += s->Read(&ball->mFollowId,    sizeof(ball->mFollowId)    );
				byteCount += s->Read(&ball->mFollowRange, sizeof(ball->mFollowRange) );
				break;
			}
		case DSTBALL_GOTO:
			{
				byteCount += s->Read(&ball->mGoto.x,    sizeof(ball->mGoto)      );
				break;
			}
		case DSTBALL_WARP:
			{
				byteCount += s->Read(&ball->mGoto.x,      sizeof(ball->mGoto)        ); // Warp destination point
				byteCount += s->Read(&effectStamp, sizeof(effectStamp) ); // Timestamp at start of warp
				ball->mEffectStamp = effectStamp;
				byteCount += s->Read(&ball->mLastCollision, sizeof(ball->mLastCollision) ); // Total length of warp
				byteCount += s->Read(&ball->mFollowId,    sizeof(ball->mFollowId)    ); // Minimum range (as double)
				byteCount += s->Read(&ball->mOwnerId,    sizeof(ball->mOwnerId)     ); // Warp factor (speed multiplier)
				break;
			}
		case DSTBALL_MUSHROOM:
			{
				double span;
				byteCount += s->Read(&ball->mFollowRange, sizeof(ball->mFollowRange) );
				byteCount += s->Read(&span              , sizeof(span)               );
				byteCount += s->Read(&effectStamp, sizeof(effectStamp) );
				ball->mEffectStamp = effectStamp;
				byteCount += s->Read(&ball->mOwnerId,     sizeof(ball->mOwnerId)     );
				ball->mGoto.x = span;
				break;
			}
		case DSTBALL_TROLL:
			{
				byteCount += s->Read(&effectStamp, sizeof(effectStamp) );
				ball->mEffectStamp = effectStamp;
				break;
			}
		case DSTBALL_STOP:
		case DSTBALL_FIELD:
		case DSTBALL_RIGID:
			{
				// Nothing to do here
				break;
			}
		default:
			{
				CCP_LOGERR_CH( s_chPThunk,"ReadBallFromStream: Unknown ball mode %d in dump", mode);
				return 0;
				break;
			}
```
`D:src/Thunkers.cpp:3023-3109` (blank lines removed)

`effectStamp` is `int32_t` (`D:src/Thunkers.cpp:3019`).

| Mode | Tail, in order | Bytes |
| --- | --- | --- |
| 0 GOTO | `goto` 3 x f64 | 24 |
| 1 FOLLOW | `followId` i64, `followRange` f32 | 12 |
| 2 STOP | nothing | 0 |
| 3 WARP | `goto` 3 x f64, `effectStamp` i32, `totalWarpLength` f64, `minRange` f64 (stored in `mFollowId`), `warpFactor` i64 (stored in `mOwnerId`) | 52 |
| 4 ORBIT | `followId` i64, `followRange` f32 | 12 |
| 5 MISSILE | `followId` i64, `followRange` f32, `ownerId` i64, `effectStamp` i32, `goto` 3 x f64 | 48 |
| 6 MUSHROOM | `followRange` f32, `span` f64 (to `mGoto.x`), `effectStamp` i32, `ownerId` i64 | 24 |
| 8 TROLL | `effectStamp` i32 | 4 |
| 10 FIELD | nothing | 0 |
| 11 RIGID | nothing | 0 |
| 12 FORMATION | `followId` i64, `followRange` f32, `effectStamp` i32 | 16 |
| 7 BOID, 9 MINIBALL, anything else | **error: record rejected, reading stops** | |

In WARP the `effectStamp` is negative while the ball is aligning and the warp-start tick once it is
warping (1.4). `minRange` is read as eight raw bytes into the integer `mFollowId`; a port should read it
as a `float64`.

### 2.6 Ball record: collision sub-shapes

After the mode tail, in this order, each present only if its flag bit is set:

```cpp
		if(flags&DSTBALL_HASMINIBALLS)
		{
			uint16_t cnt;
			byteCount += s->Read(&cnt, sizeof(cnt));
			for(int i = 0; i < cnt; i++)
			{
				Vector3d center;
				float radius;
				byteCount += s->Read(&center.x, sizeof(center));
				byteCount += s->Read(&radius, sizeof(radius));
```
`D:src/Thunkers.cpp:3114-3123`; capsules `:3132-3153`; boxes `:3154-3174`

| Flag | Count | Per item | Item bytes |
| --- | --- | --- | --- |
| `0x40` HASMINIBALLS | `uint16` | `center` 3 x f64, `radius` f32 | 28 |
| `0x80` HASMINICAPSULES | `uint16` | `hemisphereA` 3 x f64, `hemisphereB` 3 x f64, `radius` f32 | 52 |
| `0x20` HASMINIBOXES | `uint16` | `corner`, `localX`, `localY`, `localZ`, each 3 x f64 | 96 |

The coordinates are offsets from the parent ball's position (`D:src/Ball.cpp:1680-1683`,
`:1758-1763`, `:1870-1876`). With `partial == 1` (a rewind) the bytes are consumed but nothing is added
(`D:src/Thunkers.cpp:3125`, `:3145`, `:3169`). The writer sets a flag only when the list is non-empty
(`D:src/Thunkers.cpp:3201-3206`), so a count of zero is never written.

### 2.7 Record sizes for the common cases

With dynamical orientation off:

| Ball | Bytes | Sum |
| --- | --- | --- |
| RIGID, not free | 39 | 8+1+4+24+1, +1 formation |
| not free, not RIGID (for example STOP) | 64 | 38 + 25 + 1 |
| free STOP | 100 | 38 + 25 + 36 + 1 |
| free GOTO | 124 | 100 + 24 |
| free FOLLOW or ORBIT | 112 | 100 + 12 |
| free WARP | 152 | 100 + 52 |
| free MISSILE | 148 | 100 + 48 |
| free TROLL | 104 | 100 + 4 |

The emulator's encoder writes exactly this order and these widths
(`E:server/src/space/destiny/stream/ballEncoding.js:468-578`), which is the cross-check that the layout
above is the one build 3396210 reads.

### 2.8 What the reader does with each record

1. Creates or updates the ball through `AddOldStyleOrientedBall` (`D:src/Thunkers.cpp:2974-2984`), which
   calls `AddBall` (`D:src/Ballpark.cpp:3303-3461`) and then, for a free ball, snaps yaw and pitch to the
   velocity (`D:src/Ballpark.cpp:3488-3492`).
2. `AddBall` clamps and stores:
   ```cpp
       ball->mRadius        = (radius < 0.0f ?  0.0f : radius);
       ball->mMass          = (mass   < 0.0f ?  0.0f : mass);
       ...
       ball->mMaxVel        = (maxVel < 0.0f ? 0.0f : maxVel);
       ball->mAgility       = (agility <= 0.0f ?  1.0f : agility);
       ball->mSpeedFraction = (speedFraction < 0.0f ? 0.0f : speedFraction);

       SetBallTimeFactor(ball);
   ```
   `D:src/Ballpark.cpp:3391-3404`
3. For a **new** ball it also sets `mOldPos = mNewPos - dt*mNewVel` and `mOldVel = mNewVel`
   (`D:src/Ballpark.cpp:3364-3371`). For an **existing** ball it leaves `mOldPos`/`mOldVel` alone and
   resets `mFormationID = -1`, `mEffectStamp = 0`, `mOwnerId = 0`, `mFollowId = 0`,
   `mFollowRange = 10.0`, corporation, alliance and harmonic to -1, and clears a moribund flag
   (`D:src/Ballpark.cpp:3372-3389`). It does **not** clear `mFollowPtr`.
4. Free balls go into `mFreeBalls`; an existing ball that is no longer free is erased from it
   (`D:src/Ballpark.cpp:3406-3414`).
5. `AddBall` sets the mode to STOP through `SetMode` (`D:src/Ballpark.cpp:3417`). The reader then
   overwrites `mMode` directly, with no mode-change event: `ball->mMode = (DSTBALLMODE)mode;`
   (`D:src/Thunkers.cpp:3017`). It also sets `mHarmonic`, `mCorporationID`, `mAllianceID`, `isCloaked`
   (`D:src/Thunkers.cpp:3014-3018`).
6. For a non-free ball and `partial != 1`, existing mini-shapes are removed before the new ones are read
   (`D:src/Thunkers.cpp:2990-3012`).
7. After **all** records are read, follow pointers are resolved:
   ```cpp
   		case DSTBALL_FOLLOW:
   		case DSTBALL_MISSILE:
   		case DSTBALL_ORBIT:
   		case DSTBALL_FORMATION:
   			{
   				Ball *dest = mBalls[ID(b->mFollowId)];
   				CCP_ASSERT(dest);
   				if (!dest) {
   					CCP_LOGERR_CH( s_chPark, "ball %I64d to follow not found for ball %I64d", b->mFollowId, b->mId);
   					b->mMode = DSTBALL_GOTO;
   				} else {
   					b->mFollowPtr = dest;
   					dest->mFollowers.insert(b->mId);
   				}
   				break;
   			}
   ```
   `D:src/Thunkers.cpp:2484-2499`. A follower whose target is not in the park becomes a GOTO ball with
   whatever `mGoto` it had (zero for FOLLOW and ORBIT records, since they carry none).

Things the blob does **not** carry, and which are therefore lost or reset by any read, including a
rewind: `mOldPos`, `mOldVel`, `mLastG`, `mLastC`, `mNewTime`/`mOldTime`, the yaw/pitch/roll history, and
`mEffectStamp` for any mode not listed in 2.5.

### 2.9 What the writer leaves out

`WriteFullStateToStream` skips balls with `mId < DSTLOCALBALLS` (miniballs and the client's own
client-side balls) and, on a server, balls outside the viewer's bubble and other cloaked balls
(`D:src/Thunkers.cpp:2175-2188`). `WriteBallToStream` skips moribund balls (`D:src/Thunkers.cpp:3185-3188`).
The client uses the writer for its own rewind snapshots (3.6), so a port that rewinds needs the writer's
selection rules as well as the reader.

### 2.10 The rest of a SetState

`SetState` arrives with one argument, a bag. `Park.SetState` reads these attributes from it
(`C:eve/client/script/remote/michelle.py:968-1005`): `droneState`, `solItem`, `state` (the blob), `ego`,
`slims`, `damageState`, `effectStates`, `industryLevel`, `researchLevel`, `dbuffState`. Order of work:
`ClearAll()`, read the blob with `partial` 0, `self.ego = long(bag.ego)`, `_parent_Start()`, then every
slim item must name a ball that is now in the park or it raises
`RuntimeError('BallNotInPark', ...)` (`:980-985`), then `validState = True` and
`FlushSimulationHistory()`.

---

## 3. Time

Repo: `D:` for the engine, `C:` for the client's driver.

### 3.1 Tick, stamp, clock

- A **tick** is one call of `Ballpark::Evolve`. Its length is `dt = mTickInterval*0.001` seconds; with
  the default and the client's setting that is exactly 1.0 s (1.5).
- `mCurrentTime` is the tick counter. `Evolve` ends with `mCurrentTime++;` (`D:src/Ballpark.cpp:655`).
  It is also overwritten by every blob read (2.3) and is writable from Python as `currentTime`
  (`D:src/Ballpark_Blue.cpp:66-72`).
- A **stamp** on an update is the server's `mCurrentTime` at which the update was applied there. The
  server library applies the actions for tick T in `DoPreTick` while `mCurrentTime == T`, then evolves
  (`D:python/destiny/net/server/_baseticker.py:23-32`, `:42-46`; `D:python/destiny/net/server/_ticker.py:106-122`),
  and it logs an error if an entry's stamp is not the current tick
  (`D:python/destiny/net/server/_parkupdatebatcher.py:129-143`).
- `mTime` is a sim-clock time (`Be::Time`, 100 ns units), the boundary of the last tick processed.

### 3.2 The engine's tick driver

The client calls `Start()` (`C:eve/client/script/remote/michelle.py:330`, `:977`), which registers the
park for engine ticks (`D:src/Ballpark.cpp:3013-3023`). The engine then calls `OnTick(realTime, simTime)`
every frame (**NOT DETERMINED:** the calling cadence is in Blue, not in either repo; the code only
requires that it be called at least once per tick).

```cpp
    Be::Time lastDelta = simTime - mTime;

    // Remove Moribund balls every frame
    BringOutTheDeads();

    // If there hasn't yet passed a whole tick interval, then return
    if(lastDelta < mTickInterval*10000)
    {
        return;
    }
```
`D:src/Ballpark.cpp:228-238`

The first call ever evolves once with no Python callbacks:

```cpp
    if(mFirstTime)
    {
        ...
        Evolve(simTime);

        lastDelta  = 0;
        mFirstTime = false;
    }
```
`D:src/Ballpark.cpp:260-273`

Every later call runs one iteration per whole tick elapsed:

```cpp
        int intervals = int(lastDelta/(mTickInterval*10000));

        for(int i=0 ; i < intervals ; i++)
        {
            if (!PyOS->SendEvent(
                (IEveBallpark*)this, "Destiny::DoPreTick",
                "DoPreTick", NULL, "(i)", mCurrentTime
                ))
            ...
            Evolve(simTime - lastDelta);
            ...
            if (!PyOS->SendEvent(
                (IEveBallpark*)this, "Destiny::DoPostTick",
                "DoPostTick", NULL, "(i)", mCurrentTime
                ))
            ...
            lastDelta -= mTickInterval*10000;
        }
    }

    // Now lastDelta contains the 'dust' that was left.
    // Flag the last time I was called as the time minus the 'dust'..
    mTime = simTime - lastDelta;
```
`D:src/Ballpark.cpp:277-329`

Consequences:

- Per tick the order is `DoPreTick(mCurrentTime)`, `Evolve`, `DoPostTick(mCurrentTime)`. The stamp passed
  to `DoPostTick` is already incremented.
- The client's tick boundaries are at (sim time of the first `OnTick`) + n seconds. Nothing aligns that
  phase with the server's. The client and server agree only on the integer tick, never on the phase.
- The timestamp passed to `Evolve` for iteration i is `mTime_before + i*tick`: the sim time at which
  that tick's interval **began**, one whole tick before the moment it is being computed.
- A client that stalls for N seconds runs N iterations back to back. The "more than 5 ticks: resync"
  clamp at `D:src/Ballpark.cpp:246-258` applies only when `isMaster`.
- `BringOutTheDeads` runs every frame, not every tick.

`PyOS->SendEvent` reaching a Python method named `DoPreTick` on the wrapped park object is the Blue
event mechanism. **NOT DETERMINED** from these repos beyond the names; the client does define
`Park.DoPreTick(self, stamp)` and `Park.DoPostTick(self, stamp)`
(`C:eve/client/script/remote/michelle.py:900`, `:859`).

### 3.3 Evolving outside the driver

Python can also step the park directly: `Evolve()` maps to `Evolve(0)`
(`D:src/Thunkers.cpp:1244-1252`). A zero timestamp skips the interpolation-clock bookkeeping
(`D:src/Ballpark.cpp:552-560`), so catch-up steps (3.5) move the simulation without touching
`mNewTime`/`mOldTime`.

### 3.4 Receiving updates: the history queue

The client's park keeps `self.history`, a list of `[entries, waitForBubble]` pairs sorted by stamp, where
`entries` is a list of `(stamp, (name, args))` that all share one stamp. `Park.FlushState` merges an
incoming batch into it (`C:eve/client/script/remote/michelle.py:1098-1140`):

1. Empty batch: warn and return (`:1100-1102`).
2. If the **first** entry is `SetState`: remember its stamp as `latestSetStateTime` and drop every queued
   group older than it (`:1103-1106`).
3. Otherwise, if the batch's first stamp is older than `latestSetStateTime`, discard the whole batch
   (`:1108-1113`).
4. Group the batch by stamp and merge, walking the queue in order (`:1114-1137`):
   - a queued group with an earlier stamp: skip it, and clear the incoming `waitForBubble`
     (`:1123-1125`);
   - a queued group with the **same** stamp: append the new entries to it and set that group's
     `waitForBubble` to False (`:1126-1128`);
   - a queued group with a later stamp: insert the new group before it with the incoming
     `waitForBubble`, then clear the flag (`:1129-1131`);
   - anything left over is appended with the (possibly cleared) flag (`:1136-1137`).

`waitForBubble` means "another batch for this same tick is still coming". A group that is waiting
blocks the head of the queue until a second batch with the same stamp merges into it. The same merge is
`merge_state_into_history` in `D:python/destiny/net/client/_util.py:6-68`, whose docstring explains the
failure it was written to avoid; `D:python/destiny/test/net/client/test_mergestateintohistory.py` has
eleven small cases.

### 3.5 Applying updates: DoPreTick

```python
    def DoPreTick(self, stamp):
        while len(self.history) > 0:
            state, waitForBubble = self.history[0]
            if waitForBubble:
                return
            eventStamp = state[0][0]
            if eventStamp > self.currentTime and eventStamp - self.currentTime < 3:
                break
            self.RealFlushState(state)
            del self.history[0]
            if self.validState and self.shouldRebase:
                self.StoreState(midTick=True)
            if len(self.history) > 1:
                if self.history[0][1]:
                    return
                self._parent_Evolve()

        return
```
`C:eve/client/script/remote/michelle.py:900-917` (the bytecode of `Park.DoPreTick` in `michelle.pyc`
agrees with this rendering)

So, with `cur = currentTime` at the start of a client tick and `T` the stamp at the head of the queue:

| Case | What happens |
| --- | --- |
| head group is waiting for its bubble batch | nothing is applied this tick |
| `T == cur + 1` or `T == cur + 2` | **deferred**: left in the queue until the client's own ticking reaches `T` |
| `T == cur` | applied now, no stepping |
| `T >= cur + 3` | applied now: the park is stepped forward `T - cur` times first (fast-forward) |
| `T < cur` | applied now: the park is rewound to a stored snapshot and stepped forward to `T` |

The stepping is `SynchroniseToSimulationTime`:

```python
    def SynchroniseToSimulationTime(self, stamp):
        ...
        if stamp < self.currentTime:
            lastStamp = 0
            lastState = None
            for item in self.states:
                if item[1] <= stamp:
                    lastStamp = item[1]
                    lastState = item[0]
                else:
                    continue

            if not lastState:
                self.broker.LogWarn('SynchroniseToSimulationTime: Did not find any state')
                return 0
            self._parent_ReadFullStateFromStream(lastState, 1)
        else:
            lastStamp = self.currentTime
        for i in range(stamp - lastStamp):
            self._parent_Evolve()
        ...
        return 1
```
`C:eve/client/script/remote/michelle.py:1074-1096`

It is called once per group, by the first destiny-critical entry in it (6.3). After a rewind the park's
`currentTime` **is** `stamp`: the client's clock has gone backwards, and later updates that had already
been applied at ticks after `stamp` are gone ("we end up losing any updates that we have applied at
later timestamps", `D:python/destiny/net/client/_ticker.py:266-271`). The client does not step forward
again to where it was. It catches up only when a later update arrives three or more ticks ahead.

After each group, if more than one group is still queued and the next is not waiting, `DoPreTick` steps
the park once (`_parent_Evolve()`) before looking at the next group.

If the rewind finds no snapshot at or before `stamp`, `RealFlushState` reports a recoverable desync and
calls `RequestReset()`, which sets `validState = False`, drops the snapshots, and asks the server for a
new state through `remoteBallpark.UpdateStateRequest()`
(`C:eve/client/script/remote/michelle.py:1169-1173`, `:848-857`). While `validState` is false every
group is dropped with "Events ignored" (`:1153`, `:1193-1194`) until a group whose first entry is
`SetState` arrives.

### 3.6 Snapshots for rewinding

A snapshot is a full-state blob written by the client's own park plus the tick it was taken at:

```python
    def StoreState(self, midTick=False):
        if self.dirty or not self.isRunning:
            return
        ms = blue.MemStream()
        self.WriteFullStateToStream(ms)
        self.states.append([ms, self.currentTime, midTick])
        ...
        if len(self.states) > 10:
            self.states = self.states[:1] + self.states[3:3] + self.states[-5:]
        self.lastStamp = self.currentTime
        return
```
`C:eve/client/script/remote/michelle.py:919-929`. `self.states[3:3]` is an empty slice, so the trim keeps
the oldest snapshot and the newest five.

They are taken at three points:

| When | Call | Citation |
| --- | --- | --- |
| right after a group of updates is applied, before the tick's `Evolve` | `StoreState(midTick=True)`; time is the group's stamp | `C:eve/client/script/remote/michelle.py:910-911` |
| after the `Evolve` of a tick in which updates were applied | `FlushSimulationHistory()`: discard all snapshots except a mid-tick one from the previous tick, then store a new one | `:860-862`, `:1059-1072` |
| otherwise, every 11th tick | `StoreState()` when `stamp > self.lastStamp + 10` | `:863-864` |

The mid-tick snapshot exists so that a straggler for the tick just applied can be merged without losing
the updates already applied at that tick. A straggler **older** than the oldest kept snapshot cannot be
merged and forces a reset.

A rewind restores only what the blob carries (2.8). In particular, on a rewind every ball's
`mEffectStamp` is zeroed unless its mode writes it, yaw and pitch are snapped to velocity, and
mini-shapes are left as they were. A rewind also never removes anything: it is a `partial` read, so
balls added after the snapshot stay in the park in their current state, and balls removed after it
are created again (`D:python/destiny/test/net/client/test_ticker.py:90-98`).

### 3.7 How the client stays in step with the server

There is no clock exchange in the code path that applies updates. The client's tick count is set by the
stamp inside each blob it reads, advances by one per second of its own sim clock, and is corrected only
by the three rules of 3.5: wait if an update is one or two ticks ahead, jump forward if it is three or
more ahead, rewind if it is behind. `Michelle.GetRelativity` is a debug routine that asks the server for
its tick and prints the difference (`C:eve/client/script/remote/michelle.py:536-568`); it changes nothing.

When the sim clock itself is rebased, `DoSimClockRebase((old, new))` calls `AdjustTimes(new - old)`
(`C:eve/client/script/remote/michelle.py:699-703`), which shifts `mTime` and every ball's
`mPosUpdateTime`, `mRotUpdateTime`, `mNewTime`, `mOldTime` by the delta (`D:src/Ballpark.cpp:4415-4440`).
It does not touch `mCurrentTime`.

An update batch that mixes stamps is logged and reported through `clientStatsSvc.OnFatalDesync()`, and
is then merged anyway (`C:eve/client/script/remote/michelle.py:504-511`).

---

## 4. Evolve

Repo for this section: `D:`.

### 4.1 The step, in call order

`Ballpark::Evolve(Be::Time timestamp)`, `D:src/Ballpark.cpp:421-662`. All three loops iterate
`mFreeBalls`, a `std::map` keyed by id, so **in ascending ball id**. Balls that are not free are never
touched.

**Loop 1, accelerations** (`:428-444`). For each free ball that is not moribund (and, on a server only,
not in a dead bubble; `InDeadBubble` returns false when not master, `:6216-6221`):
`EvolveBehaviorForBall(ball)`:

```cpp
    ball->mLastG = Vector3d(0.0,0.0,0.0);
    ball->mLastC = Vector3d(0.0,0.0,0.0);
    ball->mCollisions.clear();

    Vector3d a = Vector3d(0.0,0.0,0.0);

    switch(ball->mMode){
    case DSTBALL_WARP:      { a = EvolveWarp(ball); break; }
    case DSTBALL_GOTO:      { a = EvolveGoto(ball); break; }
    case DSTBALL_MISSILE:   { a = EvolveMissile(ball); break; }
    case DSTBALL_FORMATION: { a = EvolveFormation(ball); break; }
    case DSTBALL_FOLLOW:    { a = EvolveFollow(ball); break; }
    case DSTBALL_ORBIT:     { a = EvolveOrbit(ball, mCurrentTime); break; }
    case DSTBALL_STOP:      { EvolveStop(ball); break; }
    default:                { break; }
    }; // End of switch statement
    ...
    ball->mLastG = a;
```
`D:src/Ballpark.cpp:791-899` (the switch at `:797-839` is shown with its line breaks and comments
removed; nothing else is changed). With dynamical orientation off
the only thing between the switch and the last line is `CapAcceleration(ball, a)`, whose first statement
is `return;` (`:1350-1353`). MUSHROOM, BOID, TROLL, MINIBALL, FIELD and RIGID fall to `default` and get
zero acceleration.

**Loop 2, integration into temporaries** (`:457-522`). For each free, non-moribund ball:

```cpp
		if( !g_useIterativeCollision && ball->isMassive )
		{
			// Get the gradient term, with contribution from nearby objects
			ball->mLastCollision = -1.0;
			Gradient(ball);
		}

        Vector3d p,v;
        p = ball->mNewPos;
        v = ball->mNewVel;

        if(ball->IsWarping())
        {
            WarpDistance(ball, p, v, (mCurrentTime - ball->mEffectStamp)*dt, false);
            if(ball->mMode == DSTBALL_STOP)
            {
                ball->mNewPos = p; // (old and new get swapped at the end)
                ball->mNewVel = v;
                Integrate(p,v, ball->mLastG + ball->mLastC, ball->mMass * ball->mAgility, mFriction, ball->mTimeFactor, dt);
                if (ball->mNewVel.LengthSq() < 0.1)
                {
                    InsertBallInBoxes(ball);
                }
            }
        }
        else
        {
			CalculateBallPositionVelocity( ball, dt, p, v );
        }
        ...
        ball->mOldPos = p;
        ball->mOldVel = v;
```
`D:src/Ballpark.cpp:467-521` (comments trimmed). With iterative collision off,
`CalculateBallPositionVelocity` is one call:
`Integrate(position, velocity, ball->mLastG + ball->mLastC, ball->mMass * ball->mAgility, mFriction, ball->mTimeFactor, timeStepFraction);`
(`D:src/Ballpark.cpp:2733`).

The results go into `mOldPos`/`mOldVel`, used here as scratch space. `mNewPos`/`mNewVel` still hold the
pre-tick state, so every ball's step is computed from the same snapshot of everyone else.

**Loop 3, commit** (`:530-639`). For each free, non-moribund ball, in this order:

1. If the mode is TROLL and `mEffectStamp <= mCurrentTime`, queue it for petrifying (`:543-550`,
   `:6315-6326`).
2. If `timestamp != 0`: `mOldTime = (mNewTime==0) ? timestamp - mTickInterval*10000 : mNewTime;`
   `mNewTime = timestamp;` (`:552-560`).
3. If the mode is MUSHROOM: grow the radius or remove the ball, then `continue` (no swap; a mushroom
   never moves) (`:562-578`).
4. `std::swap( ball->mNewPos, ball->mOldPos ); std::swap( ball->mNewVel, ball->mOldVel );`
   (`:581-582`). Now `mNewPos` is the new state and `mOldPos` is the state before this tick.
5. `ball->CalculateYawPitchRoll();` (`:596-599`): orientation only.
6. If the ball moved less than `sqrt(0.1)` m, `continue`; otherwise re-insert it in the partition, and
   for a missile dispatch collision events (`:601-638`).

Then: petrify the queued trolls (`:643-648`), `HandleProximities()` (`:652`, events only),
`mCurrentTime++` (`:655`).

### 4.2 Order-of-evaluation effects inside one tick

These follow from 4.1 and change results:

- **`EvolveStop` edits `mNewVel` in loop 1.** A ball evaluated later in loop 1 that reads another
  ball's `mNewVel` (`EvolveMissile`, new-style orbit) sees the damped value if the other ball has a
  lower id and the undamped value if it has a higher id. `EvolveFollow` and old-style orbit read only
  positions and are not affected.
- **`RealWarp` and `StopAllFollowers` run inside loop 1.** When a ball enters warp, its followers are
  switched to STOP or GOTO at that moment (4.9). A follower with a higher id is then evaluated in its
  **new** mode this tick; a follower with a lower id has already had this tick's acceleration computed
  in its old mode.
- **Warp exit writes `mNewPos`/`mNewVel` in loop 2** (the `ball->mNewPos = p` above). Collision
  detection for higher-id balls later in loop 2 sees the exit position.
- `mGoto` is rewritten in loop 1 by FOLLOW, ORBIT, MISSILE and FORMATION.

### 4.3 The integrator and the acceleration model

One function moves every non-warping ball:

```cpp
void Ballpark::Integrate(Vector3d& p, Vector3d& v, const Vector3d& a, double m, double k, double timeFactor, double t)
{
	if (t == 0.0)
		return;

	if (t != dt)
		timeFactor = exp(-k / m * t);

	const double k2 = k * k;
	const double ook2 = 1. / k2;
	const double ook = 1. / k;

	if (k < 1e-10 * m * t)
	{
		//Taylor Series expansion
		//timeFactor = 1 - k/m*t
		p = (m * (a * (-k * t) + k * (a * t + v * k / m * t)) + p * k2) * ook2;
		v = (m * a - (m * a - v * k) * timeFactor) * ook;
	}
	else
	{
		p = (m * (m * a * (timeFactor - 1.0) + k * (a * t + v - timeFactor * v)) + p * k2) * ook2;
		v = (m * a - (m * a - v * k) * timeFactor) * ook;
	}
}
```
`D:src/Ballpark.cpp:751-776`

It is always called with `m = ball->mMass * ball->mAgility` and `k = mFriction`. It is the closed-form
solution of `m dv/dt = m a - k v` with `a` constant over the step: velocity relaxes toward the terminal
value `m a / k` with time constant `m/k = mass*agility/1e6` seconds.

- **"Inertia" is the product `mMass * mAgility`.** There is no separate inertia field. Mass and agility
  never appear apart in the dynamics.
- `timeFactor` is `exp(-k t / m)`. For a whole tick the cached per-ball value is used:
  ```cpp
      double mass = ball->mMass*ball->mAgility;

      if(mass <= 0.0)
          ball->mTimeFactor = 0.0;
      else
      {
          ball->mTimeFactor = exp(-mFriction*dt/mass);
      }
  ```
  `D:src/Ballpark.cpp:4975-4982`. It is recomputed by `AddBall`, `AddMiniball`, `SetBallMass` and
  `SetBallAgility` and nowhere else (`:3404`, `:3627`, `:4666`, `:4955`). It is **not** recomputed if
  `mFriction` or `mTickInterval` is changed afterwards.
- Note the two different expressions: the cached one is `exp((-k*dt)/m)` and the partial-step one is
  `exp(((-k)/m)*t)`. They can differ in the last bit. Partial steps occur only in interpolation (7.1)
  and collision handling (5.2).
- `p` is computed before `v` and uses the old `v`.
- **Do not simplify the position line.** `p * k2 * ook2` is not `p`: `1/1e12` is not exact, so a free
  ball with zero velocity and zero acceleration can still change by one unit in the last place per
  tick. The retail client evaluates the line as written, and so must a port that wants the same bits.

**Thrust and top speed.** Every mode that steers produces an acceleration whose magnitude is at most

```cpp
    double maxThrust = mFriction*ball->mSpeedFraction*(double)ball->mMaxVel/(ball->mMass * ball->mAgility);
```
`D:src/Ballpark.cpp:1408`

With that thrust held, the terminal speed `m a / k` is `mSpeedFraction * mMaxVel`. So `speedFraction`
does not cap speed directly; it scales thrust so that the equilibrium speed is that fraction of
`mMaxVel`. A ball already moving faster than that is not clamped; it decays toward it.

**The basic steering law**, used by GOTO, FOLLOW, MISSILE, FORMATION and warp alignment:

```cpp
Vector3d Ballpark::GotoThrust(const Ball *ball, const Vector3d& target, bool missile)
{
    // This is the basic direction of the thrust: difference between the target and current point
    Vector3d a = (target - ball->mNewPos);
    double length2 = a.LengthSq();

    // This is the distance that the ball can travel during one time step
    double dist = (double)ball->mSpeedFraction * ball->mMaxVel * dt;

    // This is the maximum thrust of this ball, as defined by its mass, agility and max speed
    double maxThrust = mFriction*ball->mSpeedFraction*(double)ball->mMaxVel/(ball->mMass * ball->mAgility);

    if(!missile && length2 < dist*dist )
    {
        // if we are within 'homing' distance, then essentially use maxThrust
        // scaled with the length of the delta
        a.Normalize();
        double coff = length2/(dist*dist);
        a *= maxThrust*coff*coff;
    }
    else
    {
        // Use maxThrust
        a.Normalize();
        a *= maxThrust;
    }

    return a;
}
```
`D:src/Ballpark.cpp:1398-1426`

Full thrust straight at the target, with no regard for current velocity; inside one tick's travel of the
target the thrust is scaled by `(distance/dist)^4`. Turning is therefore not modelled separately: it is
what the friction term does to the old velocity while thrust builds the new one.

### 4.4 Arithmetic rules that change the bits

- `mRadius`, `mMaxVel`, `mAgility`, `mSpeedFraction`, `mFollowRange` are `float` (1.4). Values arrive as
  doubles from Python and are **rounded to float32 on store** (the `f` format in the thunks, section 6).
  In every formula they are promoted back to `double` before use. `0.95` becomes `0.949999988079071`.
  The fixtures in 0.2 only match with this rounding.
- `Vector3d / c` and `/=` multiply by `1.0/c`; they are not three divisions:
  ```cpp
  	Vector3d& operator /= ( double c ) { c = 1.0/c; x*=c; y*=c; z*=c; return *this; };
  	const Vector3d operator / ( double c ) const { c = 1.0/c; return Vector3d( x*c, y*c, z*c ); };
  ```
  `D:src/Vector3d.h:28`, `:46`. `Normalize` does the same and returns the vector unchanged when its
  length is exactly 0 (`D:src/Vector3d.h:62-72`).
- `c * v` is defined as `v * c` (`D:src/Vector3d.h:52`). `v * w` between two vectors is the dot product
  `x*v.x + y*v.y + z*v.z`, summed left to right (`D:src/Vector3d.h:49`). `Length` is
  `sqrt(x*x+y*y+z*z)` (`D:src/Vector3d.h:59`). `Cross` is at `D:src/Vector3d.h:74-85`.
- Expressions associate left to right: `delta * r / dist` is `(delta * r) * (1.0/dist)`.
- Everything in the position path is `double`. There is no `long double` and no x87 dependence in the
  source. **NOT DETERMINED:** the floating-point compiler flags of the retail build. What was looked
  at: `D:CMakeLists.txt` and `D:cmake/CcpBuildConfigurations.cmake` set `/O2`, `/Zi` and link options
  but no `/fp:` or `/arch:` option. The six fixtures in 0.2 reproduce exactly with no fused
  multiply-add, which is evidence that the build that produced them did not contract.
- `exp`, `log`, `sin`, `cos`, `pow` come from the C runtime. A JavaScript engine's `Math.exp` and friends
  are not guaranteed to round the same way. CCP met this between their own platforms; see the
  "Shitfix" comment quoted in 4.7. Where these enter the position path: `mTimeFactor` (one `exp` per
  mass or agility change), partial-step `Integrate` (one `exp`), old-style orbit (`cos`, `sin`, `exp`,
  each truncated to 7 decimals), warp (`exp`, `log`).

### 4.5 STOP

```cpp
void Ballpark::EvolveStop(Ball* ball)
{
	if( !g_useDynamicalOrientation )
	{
		ball->mNewVel[1] = ( ball->mNewVel[1] - 0.07 * ball->mNewVel[1] ) * 0.9345794392523364485981308411215;
	}
}
```
`D:src/Ballpark.cpp:1339-1345`

Acceleration is zero, so the ball coasts down under friction: after the step `v = v * mTimeFactor`.
**But the Y component of velocity is first multiplied by an extra factor every tick**, about 0.8692
(`0.93 * (1/1.07)`), applied as written above: subtract, then multiply by the literal. It is applied to
the stored `mNewVel` in loop 1, before integration. A stopping ship therefore loses vertical speed
faster than horizontal speed and its path bends toward the horizontal. This is the default
configuration's behaviour, and `test_stop.py` expects it (0.2). With dynamical orientation on, it is
skipped.

### 4.6 GOTO

`EvolveGoto` is `return GotoThrust(ball, ball->mGoto);` (`D:src/Ballpark.cpp:956-961`).

`GotoDirection` turns a direction into a goto point `1.0e17` m away, measured from the ball's position
at the time of the command:

```cpp
    dir.Normalize();
    dir = ball->mNewPos + dir*1.0e17;
    GotoPoint(ball,dir);
```
`D:src/Ballpark.cpp:4500-4504`. The point is fixed from then on; the ball steers at that point, not
along a constant direction.

### 4.7 FOLLOW and ORBIT

**FOLLOW** (approach, keep at range):

```cpp
    Ball *other = ball->mFollowPtr;
    Vector3d otherPos = other->mNewPos;

    // This is the difference between me and the distance
    Vector3d delta = ball->mNewPos - otherPos;
    double dist = delta.Length();
    double r = (double)ball->mFollowRange + (double)ball->mRadius + (double)other->mRadius;

    Vector3d target;

    if(dist==0.0)
    {
        // I'm right on him. Choose to go out in some arbitrary direction
        target = otherPos + Vector3d(1.0,0.0,0.0)*r;
    }
    else
    {
        // put the goto point at the specified mFollowRange along the direction connecting us
        target = otherPos + delta * r/ dist;
    }

    // Save the goto direction for other to know
    ball->mGoto = target;
    return GotoThrust(ball, target, ball->mMode==DSTBALL_MISSILE);
```
`D:src/Ballpark.cpp:1078-1103`

The goal is the point on the line between the two centres at centre distance
`followRange + ownRadius + otherRadius` from the target, on the follower's side. The target's velocity
is not used. The range is surface to surface.

**ORBIT, old style** (the default; `EvolveOrbit` dispatches on `g_useNewOrbit`, `D:src/Ballpark.cpp:1116-1123`):

```cpp
    double cruiseVelocity = (double)(ball->mSpeedFraction) * (double)(ball->mMaxVel);
    double k = mFriction;
    double maxThrust = k*cruiseVelocity/(ball->mMass * ball->mAgility);

    Ball *other = ball->mFollowPtr;
    Vector3d otherPos = other->mNewPos;

    // This is the desired distance between the balls
    double r = (double)ball->mFollowRange + (double)ball->mRadius + (double)other->mRadius;

    // This is the current distance between the two
    Vector3d toVector = (otherPos - ball->mNewPos);
    double dist = toVector.Length();
    // Make it unit
    toVector.Normalize();

    double phi1 = currentTime * ORBITAL_PRECESSION;
    // only use the last 16 bits of the mId
    // this ensures that different ships orbiting the same target will have different orbital planes
    double phi2 = (ball->mId&0x000000000000ffff) + currentTime * ORBITAL_PRECESSION;
    Vector3d radialVector = Vector3d(cos(phi1) * cos(phi2), sin(phi2), sin(phi1) * cos(phi2));
    // shitround the components to 7 decimal digits
    radialVector.x =  (double)((int64_t)(radialVector.x*10000000))/10000000;
    radialVector.y =  (double)((int64_t)(radialVector.y*10000000))/10000000;
    radialVector.z =  (double)((int64_t)(radialVector.z*10000000))/10000000;
                
    radialVector.Cross(toVector);
    radialVector.Normalize();
    // radial is now transverse to the toVector

    // Now I am going to choose a goto point that is tangent to the orbit
    double toComp = (dist*dist - r*r);
    if(toComp >= 0.0)
    {
        double radComp =  r*sqrt(toComp)/dist;

        toVector = (toComp/dist)*toVector + radComp*radialVector;
        toVector.Normalize();
    }

    // This is the ratio of thrust to put into radial component
    double radialFactor = exp(-(r-dist)*(r-dist)/40000.0);

    // Shitfix, exp() returns slightly different results depending on target platform (32bit or 64bit) so 
    // we round to 7 significant decimal digits.
    radialFactor =  (double)((int64_t)(radialFactor*10000000))/10000000;

    // Now use the law of cosine rule to get the other factor
    // First dot product of these guys is equal to the cosine of the angle between them,
    // but we are interested in the pi-angle, whence the minus sign
    phi1 =  -toVector*radialVector;

    // Now this is the determinant for the solutions
    double transverseFactor = 1.0+radialFactor*radialFactor *(phi1*phi1-1.0);

    if(transverseFactor > 0.0)
    {
        // Choose the plus solution
        transverseFactor = radialFactor*phi1 + sqrt(transverseFactor);
    }
    else
    {
        // Imaginary component in solution, just use the real part.
        transverseFactor = radialFactor*phi1;
    }

    transverseFactor *=SIGNUM(dist-r);

    // Now calculate the actual acceleration
    Vector3d a = (radialFactor*radialVector + transverseFactor*toVector)*maxThrust;
    ball->mGoto = ball->mNewPos + 10.0*AU*a;

    return a;
```
`D:src/Ballpark.cpp:1249-1328`

Supporting definitions: `double ORBITAL_PRECESSION = 0.001;` (`D:src/Ballpark.cpp:70`);
`#define SIGNUM(X) (X>=0.0?1.0:-1.0)` (`:50`); `currentTime` is `mCurrentTime` (`:825`).

Points a port must keep:

- The orbital plane depends on **the low 16 bits of the orbiter's id** and on **the tick counter**. Two
  clients agree only if they agree on `mCurrentTime` at the tick the step is taken.
- The 7-digit rounding is truncation toward zero through `int64_t`, then division by `10000000`.
- `(int64_t)` truncation makes the result insensitive to last-bit differences in `cos`, `sin` and `exp`
  except when the true value sits within one rounding error of a multiple of 1e-7.
- `radialVector` is misnamed: after the cross product it is the tangential direction.
- `-toVector*radialVector` is `-(toVector . radialVector)`.

**ORBIT, new style** (only if `g_useNewOrbit`): `EvolveNewStyleOrbit`, `D:src/Ballpark.cpp:1134-1234`,
with `GetOrbitalNormal` (`:664-733`), `GotoThrustFollow` (`:1463-1506`) and `OrbitThrust`
(`:1428-1461`). It predicts the target one tick ahead, flies an exponential spiral toward the orbit
radius, and blends a position-seeking and a velocity-matching acceleration. Not transcribed here
because it is off by default; if the retail flag turns out to be on, those three ranges are the whole
of it.

### 4.8 WARP

Warp has two phases inside one mode value. `mEffectStamp < 0` is aligning; `mEffectStamp >= 0` is
warping (`D:src/Ball.cpp:1885-1898`).

**Starting.** `WarpTo(srcId, x, y, z, minRange, warpFactor)`:

```cpp
    if(minRange < 0.0)
        minRange = 0.0;

    if(warpFactor <= 0)
        warpFactor = 1;
    ...
    Vector3d delta = (ball->mNewPos-dst);

    if(delta.LengthSq() < 10000000000.0)
    {
        // Distance too small. Do a goto point instead
        GotoPoint(ball,Vector3d(x,y,z));
        ...
        return;
    }

    if (ball->IsWarpish() && dst == ball->mGoto)
    {
        return; // no-op really, and since we don't want to reset the align counter, let's do nothing
    }

    // Stop ball from doing whatever it was doing
    Stop(ball);
    // Use persistent info about the warp
    ball->mGoto = dst;
    ball->mEffectStamp = -1;
    ball->mFollowRange =  0.0;

    // Note that we shanghai the followId member to keep a double (casting it to 64bit int)
    double tmp = minRange;
    ball->mFollowId = *((int64_t *)&tmp);

    // And we also shanghai the ownerId member to keep the desired warp speed
    ball->mOwnerId = warpFactor;

    ball->SetMode(DSTBALL_WARP);
```
`D:src/Ballpark.cpp:4087-4135`

A destination closer than 100 km (`sqrt(1e10)` m) becomes a plain GOTO.

**Aligning.** Each tick:

```cpp
    if(ball->IsWarping())
        return zero;

    if( ball->IsAlignedForWarp())
    {
        ... PostEvent "OnActivatingWarp" ...
        // Inititate the warp proper
        RealWarp(ball);

        return zero;
    }
    else
    {   // Not aligned, use goto...
        --ball->mEffectStamp; // "increment" tick counter. ...
        return EvolveGoto(ball);
    }
```
`D:src/Ballpark.cpp:920-945`

So alignment is ordinary GOTO flight toward the destination at the ball's current `speedFraction`. The
test for leaving it:

```cpp
    Vector3d dir = mGoto - mNewPos;
    dir.Normalize();
    Vector3d velDir = mNewVel;
    velDir.Normalize();

    // A ship should enter warp proper if either of the following is true:
    //   The ship is properly aligned and it has reached a speed equal to 75% its maximum speed
    if (ABS(1.0 - velDir * dir) < 0.01 && mNewVel.LengthSq() > (double)0.5625*mMaxVel * mMaxVel)
        return true;
    // OR
    //   The ship has spent MAX_ALIGN_TICKS seconds in the aligning state
    if ( ABS(mEffectStamp) > MAX_ALIGN_TICKS )
    {
        ...
        return true;
    }
    return false;
```
`D:src/Ball.cpp:1906-1922`; `#define MAX_ALIGN_TICKS 180` (`D:src/Ball.h:23`).

The speed test is against `mMaxVel`, not against `speedFraction * mMaxVel`. Thrust only drives a ball
toward `speedFraction * mMaxVel` (4.3), so a ball whose `speedFraction` is below 0.75, and which is not
already moving faster than 75% of `mMaxVel`, leaves alignment only through the timeout, once
`|mEffectStamp|` exceeds 180.

**Entering warp.**

```cpp
    StopAllFollowers(ball);
    Vector3d dst = ball->mGoto;

    // Actually offset the goto point on a 20 km radius from the point
    Vector3d delta = (ball->mNewPos-dst);
    delta.Normalize();
    dst = dst + *((double *)&ball->mFollowId)*delta;
    delta = (dst - ball->mNewPos);

    // Use persistent info about the warp
    ball->mGoto = dst;
    ball->mEffectStamp = mCurrentTime;
    ball->mLastCollision = delta.Length(); // mLastCollision repurposed for the total warp length (you're not collidable whilst in warp)
    ball->isMassive = false;
    ball->mSensor.active = false;
```
`D:src/Ballpark.cpp:4148-4163`

`mGoto` is pulled back toward the ball by `minRange`; the total warp distance is fixed at this moment
from the position the ball has then. `RealWarp` runs in loop 1; in loop 2 of the **same** tick the ball
is already "warping" and `WarpDistance` is called with `t = 0`.

**The warp profile.** Constants:

```cpp
double WARP_FACTOR_TO_AU_PER_SECOND = 0.001; // mAU/s -> AU/s
double WARP_FACTOR_TO_ACCELERATION = 1.0 / 1000; // Higher value means shorter 0-to-max-warp time
double WARP_FACTOR_TO_DECELERATION = 1.0 / 3000; // Higher value means shorter max-warp-to-0 time
```
`D:src/Ballpark.cpp:61-63`

```cpp
    warpSpeed = warpFactor * WARP_FACTOR_TO_AU_PER_SECOND * AU; // Convert to m/s units
    accelRate = warpFactor * WARP_FACTOR_TO_ACCELERATION;
    decelRate = std::min(warpFactor * WARP_FACTOR_TO_DECELERATION, 2.0);

    warpSpeed = std::min(warpSpeed, (warpDistance + 1) * accelRate * decelRate / (accelRate + decelRate));

    // Calculate the time spent and distance travelled in each phase
    accelDuration = log(warpSpeed / accelRate) / accelRate;
    cruiseDuration = (warpDistance / warpSpeed ) - (1.0 / accelRate) - (1.0 / decelRate) + (1.0 / warpSpeed);
    decelDuration = log(warpSpeed / decelRate) / decelRate;
    accelDistance = warpSpeed / accelRate;
    cruiseDistance = warpSpeed * cruiseDuration;
    decelDistance = warpSpeed / decelRate - 1;
```
`D:src/Ballpark.cpp:4238-4257` (comments trimmed). `warpFactor` is `(double)ball->mOwnerId` and
`warpDistance` is `ball->mLastCollision` (`:4264-4265`). These are recomputed on every call; nothing is
cached. The second `warpSpeed` line lowers top speed on short warps until the cruise phase has zero
length.

Position and velocity at warp time `t` seconds:

```cpp
    Vector3d dir = (ball->mGoto - p);
    dir.Normalize();
    if (t < accelDuration)
    {
        // Acceleration phase
        speed = accelRate * exp(accelRate * t);
		double currSpeed = v.Length();
		if (currSpeed > speed)
			// Faking the speed to be continuous even though it actually isn't
			speed = currSpeed;

        v = speed * dir;

        distance = exp(accelRate * t);
        p = ball->mGoto - (accelDistance + cruiseDistance + decelDistance - distance) * dir;
    }
    else if ((t - accelDuration) < cruiseDuration)
    {
        // Cruise phase
        speed = warpSpeed;
        v = speed * dir;

        distance = warpSpeed * (t - accelDuration) + accelDistance;
        p = ball->mGoto - (accelDistance + cruiseDistance + decelDistance - distance) * dir;
    }
    else if ((t - cruiseDuration - accelDuration) < (decelDuration + 1))
    {
        // Deceleration phase
        speed = warpSpeed * exp(-decelRate * (t - cruiseDuration - accelDuration));
        v = speed * dir;

        distance = warpSpeed / decelRate - (warpSpeed / decelRate) * exp(-decelRate * (t - cruiseDuration - accelDuration)) + accelDistance + cruiseDistance;
        p = ball->mGoto - (accelDistance + cruiseDistance + decelDistance - distance) * dir;

        // Once the speed drops below 50% of regular max-velocity and 100m/s, the ship drops out of warp
        if (speed < std::min(ball->mMaxVel / 2.0, 100.0) && !interpolating)
        {
            ... PostEvent "OnDeactivatingWarp" (client only) ...
            ball->isMassive = true;
            ball->mSensor.active = true;
            Stop(ball);
        }
    }
    else
    {
        ... error log: "Ship stuck in extended warp" ...
        p = ball->mGoto;
        v = Vector3d(0, 0, 0);
        distance = 0;
        if (!interpolating) { ... same exit as above ... }
    }
```
`D:src/Ballpark.cpp:4284-4359`

- `t` in `Evolve` is `(mCurrentTime - ball->mEffectStamp)*dt` (`D:src/Ballpark.cpp:480`): whole ticks
  since warp began, starting at 0.
- `p` is **not** integrated. It is placed on the line toward `mGoto` at a distance that depends only on
  `t`. The direction is recomputed each call from the ball's current position, so the only state that
  accumulates is the position itself.
- In the acceleration phase the speed is the larger of the profile speed and the speed the ball already
  has; the position ignores that and follows the profile.
- Distance covered in the first phase is `exp(accelRate*t)`, which is 1 m at `t = 0`.
- Warp ends on the first tick whose profile speed is below `min(mMaxVel/2, 100)` m/s.

**Leaving warp.** `Stop(ball)` sets STOP and (because WARP is not a follow mode) leaves `mEffectStamp`,
`mFollowId`, `mOwnerId` and `mFollowRange` as they were. Back in loop 2, the exit branch quoted in 4.1
stores the warp position and velocity as the committed-from state and integrates one ordinary friction
step from there with zero thrust. The Y-damping of 4.5 starts on the following tick.

**A warping ball that arrives in a blob** (a ship already in warp when it enters view) carries `mGoto`,
`mEffectStamp`, total length, `minRange` and warp factor in its tail (2.5), which is everything
`WarpDistance` needs. Its `isMassive` comes from its flags byte.

`EntityWarpIn(srcId, x, y, z, warpFactor)` is `WarpTo` with `minRange` 0 followed immediately by
`RealWarp`, a velocity of 1 AU/s along the direction of the vector `(x,y,z)` itself (not the direction
from the ball), and `mEffectStamp = max(mCurrentTime-5, 0)` (`D:src/Ballpark.cpp:4370-4410`).

### 4.9 Mode transitions

Every mode-changing command goes through `Stop(Ball*)` first:

```cpp
    uint8_t ballMode = ball->mMode;
	if(std::any_of(followModes.begin(), followModes.end(), [ballMode](int mode){return ballMode == mode;}) )
    {
        ... remove this ball from mFollowPtr->mFollowers ...
        ball->mEffectStamp = 0;
        ball->mFollowPtr = 0;
        ball->mFollowId = 0;
        ball->mOwnerId = 0;
        ball->mFollowRange = 0.0;
    }

    ball->SetMode(DSTBALL_STOP);
```
`D:src/Ballpark.cpp:4584-4642`

- Leaving a follow mode (FOLLOW, ORBIT, MISSILE, FORMATION) zeroes the follow fields. Leaving any other
  mode zeroes nothing.
- No command changes velocity or position except `SetBallVelocity`, `SetBallPosition`,
  `SetBallFree(false)`, `LaunchMissile` and `EntityWarpIn`. A mode change takes effect at the next
  `Evolve`.
- `Stop(const ID&)`, the form Python reaches, returns early if the ball is already in STOP
  (`D:src/Ballpark.cpp:4568-4569`).
- `GotoPoint` sets `mSpeedFraction` to 1.0 **if it is exactly 0.0**, and otherwise leaves it
  (`D:src/Ballpark.cpp:4546-4547`). `GotoDirection` goes through `GotoPoint`. `MissileFollow` sets it
  to 1.0 unconditionally (`:3868`). `FollowBall`, `Orbit`, `WarpTo` and `Stop` do not touch it.
- `SetMode` fires a `DoModeChange(old, new)` event, and `OnExitWarp` when leaving WARP
  (`D:src/Ball.cpp:905-938`). Events only.

**When a followed ball goes away.** `StopAllFollowers(ball)` runs when a ball is removed
(`D:src/Ballpark.cpp:5486`), cloaked (`:5248`), enters warp proper (`:4148`), or has its formation
cleared (`:6689`):

```cpp
		if( f->mMode == DSTBALL_MISSILE || (f->isInteractive && f->mMode == DSTBALL_ORBIT) )
        {
            if(f->mMode==DSTBALL_MISSILE)
            {
                f->isMassive = false;
            }
            GotoDirection(f ,f->mNewVel);
        }
        else
        {
            Stop(f);
        }
```
`D:src/Ballpark.cpp:5454-5467`

An interactive orbiter and any missile keep flying along their current velocity; every other follower
stops. This is why `isInteractive` has to be tracked even though it is otherwise bookkeeping.

**Preconditions that silently refuse a command.** `FollowBall` and `Orbit` return without changing
anything if the range is not finite, either ball is missing, source equals target, the target is
moribund, the two balls' `mNewBubble` differ, or the target is cloaked
(`D:src/Ballpark.cpp:3885-3925`, `:4013-4052`). On the client every `mNewBubble` is -1 (5.4), so the
bubble test always passes there.

### 4.10 The other modes

| Mode | Per-tick behaviour | Citation |
| --- | --- | --- |
| MISSILE | While `(mCurrentTime - mEffectStamp)*mTickInterval <= 800` (with 1000 ms ticks, the launch tick only), `GotoThrust` toward `mGoto` (a point 1e16 m along the launch velocity). After that, lead pursuit: aim at the target's position plus its velocity times `dist/mMaxVel`, offset by `r = followRange + radii` along the line of centres, with the `missile` flag set so the homing scale-down is skipped. `followRange` is `-(missileRadius + targetRadius)` formed in float, so `r` is 0 or a float-rounding residue. | `D:src/Ballpark.cpp:972-1011`, `:3857-3869` |
| FORMATION | `GotoThrust` toward the leader's position plus a slot offset rotated by the leader's yaw, pitch and roll. CCP's own comment calls this "old abandoned code" not used by the game's formation flight. | `D:src/Ballpark.cpp:1023-1061`, `D:src/Thunkers.cpp:1890-1898` |
| TROLL | A free ball with zero thrust (coasts). At `mEffectStamp` it is made not free, not interactive, and RIGID. | `D:src/Ballpark.cpp:6290-6337` |
| MUSHROOM | Never moves. Radius grows as `range * pow(timeFraction, 0.25f)` in **float** arithmetic, then the ball removes itself. | `D:src/Ballpark.cpp:562-578` |
| BOID, FIELD, RIGID, MINIBALL | No acceleration. If free they coast; normally they are not free and are never evolved. | `D:src/Ballpark.cpp:834-837` |

### 4.11 If dynamical orientation were on

Not the default, but for completeness: the reader would expect the extra fields 14a-14d (2.4); loop 1
would compute a torque and roll and then **reduce the linear acceleration** to its component along the
ship's new heading, `a = heading * (cos^2 * |a|)`, zero if the heading is more than 90 degrees off
(`D:src/Ballpark.cpp:841-893`); `EvolveStop` would do nothing; rotation would be integrated by
`ApplyTorque` (`:1936-1983`) in float arithmetic. Positions would differ from everything above.

---

## 5. Collision and bubbles

Repo for this section: `D:`.

### 5.1 What the client park does about collisions

The client runs the same collision code as the server. It is not disabled or simplified when
`isMaster` is false; the only master-only parts are bubble filters. In the default configuration the
path is "gradient/potential", called from loop 2 of `Evolve` for every **free, massive** ball
(`D:src/Ballpark.cpp:467-472`):

```cpp
	mPartition->GetCollisionCandidates(ball, s_uni, s_staticCollidables, isMaster);

	for (kt = s_uni.begin(); kt != s_uni.end(); ++kt)
	{
		neighbor = *kt;

		if ((ball->mMode == DSTBALL_MISSILE && (neighbor->mId == ball->mOwnerId || (neighbor->mMode == DSTBALL_MINIBALL && neighbor->mOwnerId == ball->mOwnerId))) // I am a missile, and the other guy is my daddy
			|| ((neighbor->mMode == DSTBALL_MISSILE || neighbor->mMode == DSTBALL_MUSHROOM) && ball->mId == neighbor->mOwnerId) // The other guy is a missile and I am his daddy
			|| (neighbor->mMode == DSTBALL_MISSILE && ball->mId == neighbor->mFollowId) // The other guy is a missile and I am his target
			|| (neighbor->isSpaceJunk && !ball->isSpaceJunk))
			continue; // Don't include missile launchers and mushrooms

		Potential(ball, neighbor);
	}

	for (st = s_staticCollidables.begin(); st != s_staticCollidables.end(); ++st)
	{
		if (ball->mMode == DSTBALL_MISSILE || ball->mMode == DSTBALL_MUSHROOM)
			continue; // Don't include missile launchers and mushrooms
		(*st)->CollideWithBall(ball);
	}
```
`D:src/Ballpark.cpp:2763-2783`

The output of all of it is one vector per ball, `mLastC`, which is added to `mLastG` in the integrator
call (4.1). **So collisions change positions and are part of an exact port.** They also fill
`mCollisions`, which is used only to send `DoCollision` events for missiles
(`D:src/Ballpark.cpp:616-638`, `D:src/Ball.cpp:468-488`).

### 5.2 Ball against ball: `Potential`

`D:src/Ballpark.cpp:2789-3006`. For the pair (me, other):

1. Effective masses: `mMass*mAgility` if free, else `1.0e34` (`:2796-2804`).
2. Predict both balls one tick ahead with `Integrate` using each ball's `mLastG` only (`:2813-2815`),
   then find the first contact time `s` in [0,1] of two spheres moving linearly between their start
   and predicted positions, combined radius `me->mRadius + other->mRadius`:
   `CollideTwoSpheres` (`D:src/Collision.cpp:108-135`), which returns 0.0 if they already overlap and
   -1.0 for no contact. No contact: return.
3. **Contact later in the tick (`s > 0`)** (`:2841-2888`). Integrate both to `s*dt`; the normal is the
   line of centres at contact.
   - Other ball not free: reflect my velocity, `vp1 -= 2.0*v1*normal;` (`:2864`).
   - Other ball free: a one-dimensional elastic exchange along the normal using the **base** masses
     (not multiplied by agility):
     ```cpp
     			v1p = (mm1*v1 - mm2 * v1 + 2.0*mm2*v2) / (mm1 + mm2);
     			...
     			vp1 += (v1p - v1)*normal;
     ```
     `:2878-2881`
   - Then integrate the rest of the tick, `(1.0 - s)*dt`, and solve for the constant acceleration that
     would have produced that end velocity over the whole tick:
     ```cpp
     			a1 = -(-m1 * me->mLastG + me->mTimeFactor*m1*me->mLastG - me->mTimeFactor*me->mNewVel*k + vp1 * k) / m1 / (me->mTimeFactor - 1.0);
     ```
     `:2870`, `:2885`
4. **Already overlapping (`s == 0`)** (`:2889-2980`). The distance to clear is
   `collRadius - sqrt(p0q0_2) + 1` (one extra metre). If both are free, the balls are temporarily moved
   apart in proportion to the other's effective mass and `Potential` is re-run from there (depth limit
   2); if the mass ratio exceeds 25 the lighter ball's response is rescaled to the clearance distance;
   and the function returns early if the two velocities differ. Otherwise a direct push-out
   acceleration is used:
   ```cpp
   		tmp = 1.0 / (m1 + dt * mFriction);
   		a1 = ((-d1 / (dt*tmp*m1))*normal - me->mNewVel) / dt - normalComp * normal;
   ```
   `:2977-2978`. Two balls at exactly the same point use the normal `(1,0,0)` or `(-1,0,0)` chosen by
   which id is larger (`:2897-2903`).
5. **Choosing among several colliders** (`:2983-3003`):
   ```cpp
   	if ((me->mMode != DSTBALL_MISSILE || other->mId != me->mFollowId) && s >= me->mLastCollision)
   	{
   		Vector3d lastC = 0.85 * a1;
   		if (s == me->mLastCollision)
   		{
   			// Use the stronger collision of the two
   			if (lastC.LengthSq() > me->mLastC.LengthSq())
   			{
   				me->mLastC = lastC;
   			}
   		}
   		else
   		{
   			me->mLastC = lastC;
   			me->mLastCollision = s;
   		}
   	}
   ```
   The response is the bounce acceleration **scaled by 0.85**. Only one collider's response survives per
   ball per tick, and which one depends on the order the candidates are visited.

So: reflection off fixed objects and elastic exchange between free balls, both damped by 0.85, applied
as an acceleration over the whole tick. `Potential` only writes to `me`. Each pair is evaluated twice,
once from each side, each time from the same pre-tick state.

### 5.3 Ball against capsule and box

A fixed ball's mini-capsules and mini-boxes are separate "static collidables" in the park
(`D:src/Ball.cpp:1743-1767`, `:1855-1879`). Its miniballs are real fixed `Ball`s with mode MINIBALL,
the parent's mass, and an id from the local counter (`D:src/Ballpark.cpp:3559-3637`); they collide
through `Potential`. Mini-shapes exist in the park **only while the parent is not free**
(`D:src/Ballpark.cpp:4907-4910`, `:4927-4930`).

- Capsule: `Capsule::CollideWithBall` (`D:src/Capsule.cpp:365-393`) predicts the ball one tick ahead and
  calls `HandleCollisionNonIteratively` (`:206-363`), then `ReactToCollision` (`:395-447`).
- Box: `OrientedBox::CollideWithBall` (`D:src/OrientedBox.cpp:44-74`) using `BoxShape::CollideWithSphere`
  (`D:src/BoxShape.cpp:200-295`), then `OrientedBox::ReactToCollision` (`D:src/OrientedBox.cpp:76-125`).

Both reactions use the same reflect-then-solve-for-acceleration formula as step 3 above, the same 0.85
factor, and the same "latest contact time wins, equal times keep the stronger" rule against
`mLastCollision`, except that they compare with `==` and otherwise overwrite unconditionally
(`D:src/Capsule.cpp:430-444`, `D:src/OrientedBox.cpp:109-122`). Static collidables are visited after all
balls.

### 5.4 The spatial partition, and bubbles

The partition is a hierarchy of 8 levels of cubic boxes (`D:src/Partition.cpp:19-40`):

```cpp
    mNumberOfLevels(8),
    mGridUnit(480.0) // base unit of small-scale partition
    ...
    double bigbox = (1 << (2*mNumberOfLevels))*mGridUnit*0.25;
    ...
        width = bigbox/(1 << 2*i);
```

Level 0 boxes are 7,864,320 m wide and each level is a quarter of the one above, down to 480 m at level
7 (the test helper states the same rule, `D:python/destiny/test/helpers.py:240-245`). The comment at
`D:src/Ball.cpp:2434` that speaks of a "top-level grid size of 245km" does not match this arithmetic.

A ball is filed at the deepest level whose box is at least three times its inflated radius
(`D:src/Partition.cpp:113-119`), in the box containing its centre plus the neighbours it could reach
this tick (`D:src/Ball.cpp:2348-2520`); the inflated radius is the radius plus one tick of travel at
the fastest speed the ball could have (`D:src/Ball.cpp:838-853`). Candidates for a ball are every ball
and static collidable in its boxes, their ancestors and their descendants
(`D:src/Partition.cpp:344-487`), filtered: not itself, not moribund, not cloaked, **not non-massive**,
not a missile, and force fields (mode FIELD) are skipped when the harmonic, corporation or alliance
matches or the ball's harmonic is -2 (`D:src/Partition.cpp:423-455`). A missile's only candidate is its
target, unless its owner id is negative (`D:src/Partition.cpp:308-319`).

The partition decides two things: **which** pairs are tested and **in what order**. It never moves a
ball. The order is: the ball's boxes in key order (`D:src/Box.cpp:278`); for each, ancestors, then
descendants, then the box itself; within a box, balls in id order with local (negative-id) balls
ordered by owner first (`D:src/Ball.cpp:2522-2543`).

**Bubbles are server-side.** A bubble id is assigned to a ball only inside `if(isMaster)`
(`D:src/Ballpark.cpp:3118`, `:3128-3178`); a client ball's `mNewBubble` stays at its default of -1
(`D:src/Partitionable.cpp:11`). `InDeadBubble` is false on a client (`D:src/Ballpark.cpp:6218-6221`),
the bubble filter in candidate selection is master-only (`D:src/Partition.cpp:435`), and the retail
client never calls `InitializeBubbles` (no occurrence in any `.py` under `C:`). To the client, a
bubble is simply "the balls the server has told me about". `waitForBubble` (3.4) is about batching of
updates and has nothing to do with this.

### 5.5 Must port, and bookkeeping

| Piece | Affects a ball's position? | Notes |
| --- | --- | --- |
| `Gradient`, `Potential`, `CollideTwoSpheres`, `Quadratic` | **Yes**, whenever two massive balls come within contact in a tick | includes the 0.85 factor and the selection rule |
| Capsule and box collision | **Yes**, near fixed objects that carry mini-shapes | |
| Miniballs | **Yes** (they are colliders) | need the local-id generator and the owner-first ordering |
| Partition | Not directly | needed only to reproduce the candidate order when a ball has two or more colliders in one tick; with at most one collider any correct broad phase gives the same answer |
| `isMassive`, `isCloaked`, `isSpaceJunk`, harmonic/corp/alliance | **Yes**, through the filters | |
| Bubbles, bubble transitions, interactive counts, keep-alives | No | master only |
| Proximity sensors, notification range, target tracking | No | they fire events; the sensor check temporarily changes radius and velocity and restores them (`D:src/Ball.cpp:657-669`) |
| Moribund handling | Indirectly | a moribund ball is frozen and invisible to collisions |

If iterative collision were on, none of 5.2-5.3 would apply; the path would be
`CalculateIterativeCollisionResponses` (`D:src/Ballpark.cpp:332-403`) and the functions at
`:1988-2682` with `D:src/CollisionBallProperties.cpp`.

Whether the server corrects clients after a bump (for example with `SetBallVelocity`) is
**NOT DETERMINED**: the game server's use of the library is not in either repo. The library itself
sends nothing on collision.

---

## 6. Update events

Repos: `C:` for dispatch, `D:` for what each call does.

### 6.1 The notification as the client receives it

The `michelle` service lists these in `__notifyevents__` (recovered from `michelle.pyc`; shown as
integers at `C:eve/client/script/remote/michelle.py:72-83`): `DoDestinyUpdate`, `DoDestinyUpdates`,
`OnFleetStateChange`, `OnDroneStateChange`, `OnDroneActivityChange`, `OnAudioActivated`,
`DoSimClockRebase`, `OnPrimaryViewChanged`, `OnSpaceWhiteOutStart`, `OnAsteroidRevealed`,
`OnAsteroidTerminated`.

```python
    def DoDestinyUpdate(self, state, waitForBubble, dogmaMessages=[]):
        self.LogInfo('DoDestinyUpdate call for tick', state[0][0], 'containing', len(state), 'updates.  waitForBubble=', waitForBubble)
        if self.__bp is None:
            return
        else:
            if dogmaMessages:
                self.LogInfo('OnMultiEvent has', len(dogmaMessages), 'messages')
                sm.ScatterEvent('OnMultiEvent', dogmaMessages)
            expandedStates = []
            for action in state:
                if action[1][0] == 'PackagedAction':
                    try:
                        unpackagedActions = blue.marshal.Load(action[1][1])
                        expandedStates.extend(unpackagedActions)
                    except StandardError:
                        ...
                else:
                    expandedStates.append(action)

            state = expandedStates
            timestamps = {action[0] for action in state}
            if len(timestamps) > 1:
                ... sm.GetService('clientStatsSvc').OnFatalDesync()
            self.__bp.FlushState(state, waitForBubble)
            return
```
`C:eve/client/script/remote/michelle.py:482-512`

| Argument | Shape | Meaning |
| --- | --- | --- |
| `state` | non-empty list of `(stamp, (name, args))` | `stamp` an integer tick; `name` a string; `args` a tuple. Every element is unpacked as a 2-sequence twice (`:1158-1159`) |
| `waitForBubble` | truthy or falsy | "a second batch for this tick is coming; hold this one" (3.4) |
| `dogmaMessages` | optional list | scattered as `OnMultiEvent` **before** the destiny entries are queued; not otherwise part of destiny |

- `state[0][0]` is evaluated in the first line, so an empty `state` raises before anything else.
- An entry named `PackagedAction` has a marshalled list of ordinary entries as its second element, not
  an args tuple; the list is spliced in place. The server library builds these for bubble additions
  and removals (`D:python/destiny/net/server/_parkupdatebatcher.py:253-278`).
- `DoDestinyUpdates(updates)` is a list of 2- or 3-tuples, each passed to `DoDestinyUpdate` in order
  (`C:eve/client/script/remote/michelle.py:514-525`).

The open-source server library's batcher sends `(state, wait_for_bubble, update_count)` with
`update_count` 1 or 2 (`D:python/destiny/net/server/_parkupdatebatcher.py:89-107`, `:122`;
`D:python/destiny/net/const.py:6-8`). The retail client's third parameter is `dogmaMessages` instead,
so the game server does not use that batcher unchanged. The retail client's signature is the one to
follow.

### 6.2 Three kinds of entry

`Park.__init__` builds three sets (recovered from `michelle.pyc`, `Park.__init__` constants 5-30; shown
as integers at `C:eve/client/script/remote/michelle.py:816-839`):

| Set | Members |
| --- | --- |
| `localActions` | `AddBalls`, `AddBalls2`, `RemoveBalls`, `SetState`, `RemoveBall`, `TerminalPlayDestructionEffect` |
| `nonDestinyCriticalFunctions` | `OnDamageStateChange`, `OnSpecialFX`, `OnFleetDamageStateChange`, `OnShipStateUpdate`, `OnSlimItemChange`, `OnDroneStateChange`, `OnSovereigntyChanged`, `OnDbuffUpdated`, `OnClientControllerEvent`, `OnDotVictimUpdated` |
| `scatterEvents` | `Orbit`, `GotoDirection`, `WarpTo`, `SetBallRadius`, `GotoPoint`, `SetBallInteractive`, `SetBallFree`, `SetBallHarmonic`, `FollowBall`, `Stop` |

### 6.3 How a group is applied: RealFlushState

Reconstructed from the bytecode of `Park.RealFlushState` in `michelle.pyc` (offsets in brackets). The
decompiled text at `C:eve/client/script/remote/michelle.py:1164-1186` shows the second `if` as a
sibling of the first; in the bytecode the first branch jumps to the end of the `try` body [354 to 647],
so everything from "synchronise" down belongs to the `else`.

```
RealFlushState(state):
    if state is empty: warn, return                                  [28-65]
    eventStamp, (funcName, args) = state[0]                          [66-91]
    if funcName == 'SetState':                                       [94-169]
        apply(self.SetState, args)
    if not self.validState: log 'Events ignored'; return             [172-178, 722-737]
    self.shouldRebase = False                                        [181-187]
    synchronised = False                                             [190-193]
    exploders = {x[1][1][0]: x[1][1][-1] for x in state
                 if x[1][0] == 'TerminalPlayDestructionEffect'}      [196-209]
    for (eventStamp, (funcName, args)) in state:                     [212-246]
        if funcName == 'SetState': continue                          [249-261]
        try:
            if funcName in self.nonDestinyCriticalFunctions:         [317-354]
                apply(getattr(self, funcName), args)
            else:
                if not synchronised:                                 [357-378]
                    synchronised = self.SynchroniseToSimulationTime(eventStamp)
                if not synchronised:                                 [381-441]
                    clientStatsSvc.OnRecoverableDesync(); self.RequestReset(); return
                self.shouldRebase = True                             [442-448]
                if funcName in self.localActions:                    [451-516]
                    if funcName == 'RemoveBalls': args = args + (exploders,)
                    apply(getattr(self, funcName), args)
                else:                                                [519-641]
                    apply(getattr(self, '_parent_' + funcName), args)
                    if funcName in self.scatterEvents:
                        sm.ScatterEvent('OnBallparkCall', funcName, args)
                    if funcName == 'CloakBall':
                        if self.ego and self.ego != args[0]:
                            self.RemoveBall(args[0])
        except Exception:                                            [651-711]
            log '<funcName> failed.'; continue
```

What follows from it:

- `SetState` is honoured only as the **first** entry of a group. Anywhere else it is skipped.
- Entries are applied **in list order**. Within one stamp that is arrival order of batches, then order
  inside each batch (3.4).
- The first entry that is not in `nonDestinyCriticalFunctions` moves the park to the group's stamp
  (3.5). Entries in that set are applied without moving the park and do not mark the tick for a
  snapshot rebase.
- Any name that is in neither set is called on the C++ park as `_parent_<name>`. **The client does
  not check the name against a list.** A name that is not an exposed park method raises, is logged,
  and the loop continues with the next entry.
- An exception in one entry does not stop the group.

How `_parent_<name>` resolves to the C++ method is the Blue wrapper mechanism (`decometaclass` on the
Python side, `C:decometaclass/decometaclass.py:9-46`); the C++ half is **NOT DETERMINED** from these
repos. The exposed method names and their C++ handlers are the table in
`D:src/Ballpark_Blue.cpp:292-752`.

### 6.4 Entries handled in Python (`localActions`)

| Name | Arguments | What it does | Citation |
| --- | --- | --- | --- |
| `SetState` | `(bag,)` | 2.10: clear everything, read `bag.state` as a full state, set ego, start ticking, rebuild slim items, mark state valid, take a snapshot | `C:eve/client/script/remote/michelle.py:968-1005` |
| `AddBalls` | `(chunk,)` with `chunk = (state, slims, damageDict)` | read `state` with `partial` 2; register slim items not already known; store damage states | `:1235-1254` |
| `AddBalls2` | `(chunk,)` with `chunk = (state, extraBallData)`; each element of `extraBallData` is either `(slimItemDict, damageState)` or a bare `slimItemDict` | read `state` with `partial` 2; build a `SlimItem` from each dict | `:1256-1278` |
| `RemoveBalls` | `(ballIDs,)`; the client appends `exploders` | for each id that is 0 or more and present: `_parent_RemoveBall(id, delay)`; drop slim item and damage state | `:1332-1370` |
| `RemoveBall` | `(ballID,)` or `(ballID, terminal)` | `_parent_RemoveBall(ballID, delay)`; drop slim item | `:1303-1329` |
| `TerminalPlayDestructionEffect` | `(shipID, destructionEffectId)` | records which effect to play when the ball is removed; no simulation effect | `:1197-1206` |

`delay` is in ticks and comes from the ball's graphics object
(`ball.GetTotalDestructionEffectTime()`, `:1310`, `:1357-1358`); how that number is computed was not
examined. It affects only how long the dead ball stays in `balls` (below).

The C++ removal, `Ballpark::RemoveBall(srcId, delay)` (`D:src/Ballpark.cpp:5471-5592`):

1. `Stop(ball)`, then `StopAllFollowers(ball)` (4.9). This is the part that changes other balls.
2. `isMoribund = true`. From here the ball is skipped by `Evolve`, by candidate selection, and by the
   snapshot writer.
3. If called during `Evolve` or with `delay > 0`: `isMassive = false`,
   `mEffectStamp = mCurrentTime + delay`, park it in `moribundBalls`, return (`:5530-5540`). It is
   finally removed by `BringOutDeadBalls`, which runs every frame and removes a moribund ball once
   `mEffectStamp - mCurrentTime < 0`, or up to 7 per frame once it is within 2 ticks of that
   (`:5708-5765`).
4. Otherwise remove it from the partition, `mFreeBalls`, `mGlobals` and `mBalls` at once.

The open-source client ticker has a fourth local action, `AddBallsToPark(state)`, which reads a balls
packet with `partial` 2 (`D:python/destiny/net/client/_ticker.py:14-18`, `:344-353`), and its server
library emits that name (`D:python/destiny/net/server/_parkupdatebatcher.py:227-231`). The retail
`michelle.Park` has no method of that name and no such park method is exposed, so in the retail client
that entry would fail as an unknown `_parent_` call. The retail equivalents are `AddBalls` and
`AddBalls2`.

### 6.5 Entries applied to the C++ park

Argument types are from the `PyArg_ParseTuple` format in each thunk: `L` int64, `d` double, `f` float
(the Python number is **rounded to float32**), `i` int, `b` char, `|` starts optional arguments. The
first argument is always the ball id. Names in the left column that are in `scatterEvents` (6.2) are
also broadcast to the UI as `OnBallparkCall`.

**Movement commands**

| Name | Arguments (format) | Effect | Thunk | Implementation |
| --- | --- | --- | --- | --- |
| `GotoDirection` | `id, x, y, z` (`Lddd`) | normalise; goto point = position + direction x 1e17; then as `GotoPoint` (4.6) | `D:src/Thunkers.cpp:461-482` | `D:src/Ballpark.cpp:4471-4505` |
| `GotoPoint` | `id, x, y, z` (`Lddd`) | ignore if not finite; `Stop`; `mGoto = p`; `speedFraction` 0 becomes 1; mode GOTO | `:435-456` | `:4511-4550` |
| `FollowBall` | `id, targetId, range=1.0` (`LL\|f`) | preconditions of 4.9; `Stop`; set `mFollowId`, `mFollowPtr`, `mFollowRange`; mode FOLLOW; add to target's followers. A negative `targetId` raises in the thunk | `:244-270` | `:3879-3941` |
| `Orbit` | `id, targetId, range=1.0` (`LL\|f`) | as `FollowBall` but mode ORBIT | `:330-355` | `:4007-4066` |
| `WarpTo` | `id, x, y, z, minRange=20000.0, warpFactor=20` (`Lddd\|di`) | 4.8. `warpFactor` must be an integer | `:360-383` | `:4072-4137` |
| `Stop` | `id` (`L`) | no-op if already STOP; else `Stop(ball)` (4.9) | `:596-611` | `:4556-4643` |
| `SetSpeedFraction` | `id, fraction` (`Lf`) | ignore NaN; clamp to [0,1]; store. Does not change mode | `:709-726` | `:4990-5024` |
| `EntityWarpIn` | `id, x, y, z, warpFactor` (`Ldddi`) | 4.8 | `:389-410` | `:4370-4410` |
| `LaunchMissile` | `id, targetId, ownerId, aimedLaunch, massive` (`LLLbb`) | place the missile at the owner's position with a launch velocity, then `MissileFollow`. If the owner is not moving, the launch direction is the owner's facing, which depends on its yaw/pitch/roll | `:857-946` | same |

The client's own consumers confirm some shapes: `WarpTo` is read as `args[1:-2]` for the destination
(`C:eve/client/script/parklife/autopilot.py:173`), `FollowBall` and `Orbit` as
`(id, targetID, distance)` (`C:tacticalNavigation/tacticalNavigationService.py:542-543`),
`SetBallFree` as `(itemID, isFree)` (`C:eve/client/script/parklife/bracketMgr.py:740`), `SetBallRadius`
as `(ballID, newRadius)` (`C:eve/client/script/parklife/spaceMgr.py:403-405`).

**State setters**

| Name | Arguments (format) | Effect | Thunk | Implementation |
| --- | --- | --- | --- | --- |
| `SetBallPosition` | `id, x, y, z` (`Lddd`) | set `mNewPos` **and** `mOldPos`; re-file in the partition | `D:src/Thunkers.cpp:661-682` | `D:src/Ballpark.cpp:4738-4764` |
| `SetBallVelocity` | `id, vx, vy, vz` (`Lddd`) | set `mNewVel` **and** `mOldVel`; snap yaw/pitch | `:777-798` | `:4770-4800` |
| `SetBallMass` | `id, mass` (`Ld`) | ignored if `mass <= 0`; store; recompute `mTimeFactor` | `:487-504` | `:4652-4667` |
| `SetBallAgility` | `id, agility` (`Lf`) | ignored if `<= 0`; store; recompute `mTimeFactor` | `:687-704` | `:4940-4956` |
| `SetMaxSpeed` | `id, speed` (`Lf`) | ignored if `< 0`; store `mMaxVel`; re-file | `:573-590` | `:4703-4719` |
| `SetBallRadius` | `id, radius` (`Lf`) | ignored if `< 0`; store; re-file | `:552-569` | `:4673-4697` |
| `SetBallMassive` | `id, flag` (`Li`) | store `isMassive` | `:1054-1071` | `:5074-5085` |
| `SetBallFree` | `id, flag` (`Li`) | see below | `:980-997` | `:4887-4934` |
| `SetBallGlobal` | `id, flag` (`Li`) | store `isGlobal`; maintain `globals` | `:1033-1050` | `:5091-5114` |
| `SetBallInteractive` | `id, flag` (`Li`) | store `isInteractive` (bubble counts are no-ops on a client) | `:1076-1093` | `:6339-6365` |
| `SetBallHarmonic` | `id, harmonic, corporationID, allianceID, field` (`LLiii`) | store the three; if `field`, `Stop` then mode FIELD; if not and mode is FIELD, `Stop` | `:952-975` | `:4852-4880` |
| `SetBallTroll` | `id, delay` (`Li`) | `Stop`; make free and interactive; `mEffectStamp = mCurrentTime + max(delay,1)`; mode TROLL | `:530-547` | `:6290-6313` |
| `SetBallRigid` | `id` (`L`) | `Stop`; mode RIGID | `:509-524` | `:6278-6289` |
| `CloakBall` | `id, cloakMode, range=2000.0` (`Lb\|f`) | ignored if `cloakMode <= 0`; `StopAllFollowers`; `isCloaked = cloakMode`; `isMassive = false`. The client then **removes** the ball unless it is its own (6.3) | `:1846-1865` | `:5223-5251` |
| `UncloakBall` | `id` (`L`) | `isCloaked = 0`; `isMassive = true` unless in warp proper | `:1870-1885` | `:5257-5292` |
| `AddMushroom` | `ownerId, range, time` (`Lfd`) | add a fixed mushroom ball with id 0 at the owner | `:306-325` | `:3719-3789` |

`SetBallFree(id, true)` adds the ball to `mFreeBalls`, removes its mini-shapes from the park, and sets
`mNewTime = mTime - tick`. `SetBallFree(id, false)` does `Stop`, zeroes velocity (new and old), removes
it from `mFreeBalls`, zeroes `mLastG`, and adds its mini-shapes back (`D:src/Ballpark.cpp:4902-4931`).
Nothing happens if the flag is unchanged.

Also exposed and reachable by name, all dynamical-orientation only: `SetMaxAngularSpeed` (`Lf`),
`SetBallAngularVelocity` (`Lddd`), `SetBallRotation` (`Ldddd`), `SetBallAngularAgility` (`Lf`)
(`D:src/Thunkers.cpp:800-849`). The server library can also emit `SetMaxAngularVelocity`
(`D:python/destiny/net/server/_actions.py:205-209`), for which no park method is exposed.

A command for a ball that is not in the park is ignored by every method above: each begins with a
null check, and a few log a warning first.

### 6.6 Names the server library can emit

For reference, the action names in CCP's server-side library, each with the ball id inserted as the
first argument unless noted (`D:python/destiny/net/server/_actions.py`): `GotoPoint` (`:93-97`),
`GotoDirection` (`:111-115`), `Orbit` (`:127-131`), `SetBallTroll` (`:144-148`), `SetBallVelocity`
(`:163-167`), `SetBallMassive` (`:244-248`), `Stop` (`:256-259`), `SetBallMass` (`:270-274`),
`SetBallAgility` (`:287-291`), `SetSpeedFraction` (`:399-403`), `WarpTo` with
`(x, y, z, minimum_range, warp_speed)` (`:423-427`), `EntityWarpIn` (`:446-450`), `SetBallPosition`
(`:468-473`), `SetBallHarmonic` (`:504-508`), `SetBallRadius` (`:519-523`), `SetBallFree` (`:534-538`),
`SetBallInteractive` (`:548-552`), `FollowBall` (`:564-568`), `SetMaxSpeed` (`:578-582`), `CloakBall`
(`:633-638`), `UncloakBall` (`:648-651`), `LaunchMissile` (`:671-675`), and the orientation setters.
`BallNotGlobal` and `RemoveGlobalBall` are turned into `RemoveBall` entries before sending
(`D:python/destiny/net/server/_ticker.py:178-196`). `warp_speed` is documented there as
"mAU/s (1/1000th of an AU per second)".

**NOT DETERMINED:** the exact set of names and argument values the retail game server sends; its code
is not in either repo. The emulator's own list is at `E:server/src/space/destiny/stream/actions.js:28-369`.

### 6.7 Entries that are not destiny (`nonDestinyCriticalFunctions`)

Applied immediately, in order, without synchronising the park. None touches the simulation.

| Name | Signature | Citation |
| --- | --- | --- |
| `OnDamageStateChange` | `(shipID, damageState)` | `C:eve/client/script/remote/michelle.py:1536-1543` |
| `OnFleetDamageStateChange` | `(shipID, damageState)` | `:1545-1550` |
| `OnSpecialFX` | `(shipID, moduleID, moduleTypeID, targetID, otherTypeID, guid, isOffensive, start, active, duration=-1, repeat=None, startTime=None, timeFromStart=0, graphicInfo=None)` | `:1552-1559` |
| `OnShipStateUpdate` | `(shipState)` | `:1529-1534` |
| `OnSlimItemChange` | `(itemID, newSlim)` | `:1482-1494` |
| `OnDroneStateChange` | `(itemID, ownerID, controllerID, activityState, typeID, controllerOwnerID, targetID)` | `:1496-1518` |
| `OnSovereigntyChanged` | `(*args)` | `:1570-1572` |
| `OnDbuffUpdated` | `(shipID, dbuffState)` | `:1574-1576` |
| `OnDotVictimUpdated` | `(targetID, dmgAppsInfo)` | `:1578-1580` |
| `OnClientControllerEvent` | `(ballID, targetID, eventName, value=None, delay=None)` | `:1582-1584` |

---

## 7. Reading state out

Repos: `D:` for the engine, `C:` for how the client uses it.

### 7.1 Position between ticks

The raw tick state is `ball.x/y/z` (`mNewPos`) and `ball.vx/vy/vz` (`mNewVel`). The client draws and
measures with an interpolated position instead, `ClientBall::InterpolatedPosition(out, time)`
(`D:src/Ball.cpp:1208-1312`):

```cpp
    // Shift time down one tick
    Be::Time shiftedTime  = GetShiftedTime(time);
    ...
    if(mOldTime==mNewTime)
    {
        // No interpolation possible. Just return the newest value
        mLastPos = mNewPos;
        mPosUpdateTime = shiftedTime;
        *out = mLastPos;
        return out;
    }
            
    InforceContinuity();
    ...
    // timeStepFraction tells us how far we are in the interpolation segment. Should usually be between 0 and 1.
    double timeStepFraction = TimeAsDouble(shiftedTime-mOldTime);
    ...
    // Calculate the new position
    if( IsWarping() )
    {
        double t = ((mPark->mCurrentTime - mEffectStamp) - 1 + timeStepFraction)*mPark->dt;
        mPark->WarpDistance(
            this,
            mLastPos,
            mLastVel,
            t,
            true
        );
    }
    else
    {
        mLastPos = mOldPos;
        mLastVel = mOldVel;
		mPark->CalculateBallPositionVelocity(this, timeStepFraction, mLastPos, mLastVel);
    }
```
`D:src/Ball.cpp:1220-1292` (abridged)

```cpp
    return time - 2*mPark->mTickInterval*10000;
```
`D:src/Ball.cpp:1324` (`GetShiftedTime`; despite the comment it subtracts **two** ticks)

So this is **not** linear interpolation between two points. It re-runs the integrator from the state
one tick ago (`mOldPos`, `mOldVel`) with the acceleration the last `Evolve` used (`mLastG + mLastC`)
for a fraction of a tick; at a fraction of exactly `dt` it lands on `mNewPos`. For a fraction other
than `dt` the integrator computes its own `exp` (4.3).

Timing, combining this with 3.2: when the tick that produces counter value `c` is computed, the sim
clock reads at least `S + tick`, where `S` is the timestamp given to that `Evolve`. Then
`mNewTime = S`, `mOldTime = S - tick`, and at sim time `now` the fraction is
`(now - 2*tick) - (S - tick) = now - S - tick`, which runs from 0 to 1 until the next tick is computed.
**The displayed state is one whole tick behind the computed state**: at the moment state `c` is
computed the display shows state `c - 1`, and it reaches `c` one second later.

- `TimeAsDouble` is not defined in this repo. Its result is passed to `Integrate` as a time in seconds
  against `dt = 1.0`, so it must convert `Be::Time` to seconds. **NOT DETERMINED** beyond that
  inference.
- If the same shifted time is asked for twice the cached `mLastPos` is returned; a time earlier than
  the last one asked for also returns the cache (`D:src/Ball.cpp:1223-1240`).
- Before the ball's first driver tick `mOldTime == mNewTime == 0` and the function returns `mNewPos`.
- During warp the interpolation calls `WarpDistance` with the `interpolating` flag, which suppresses
  the warp-exit side effects, and passes the previous interpolated position as the point from which
  the direction is taken.
- Catch-up steps (3.3) do not move `mOldTime`/`mNewTime`, so after a fast-forward or rewind the
  fraction keeps running on the old clock while `mOldPos`/`mNewPos` have jumped.

### 7.2 The Python entry points

The client calls `ball.GetVectorAt(time)`, `ball.GetVectorDotAt(time)` and
`ball.GetQuaternionAt(time)` with `blue.os.GetSimTime()`
(`C:eve/client/script/ui/inflight/overview/overviewWindow.py:1045`,
`C:eve/client/script/ui/inflight/shipHud/activeShipController.py:167`, `:223`). Those names are not in
the destiny repo. `ClientBall` implements the Trinity interfaces `ITriVectorFunction` and
`ITriQuaternionFunction` (`D:src/Ball.h:395-399`, `D:src/Ball_Blue.cpp:542-543`), whose methods here are
`GetValueAt`, `GetValueDotAt`, `GetValueDoubleDotAt`. **NOT DETERMINED:** the mapping from the Python
names to these methods; it lives in the Trinity interface exposure. Assuming the obvious mapping:

| Python | C++ | Returns | Citation |
| --- | --- | --- | --- |
| `GetVectorAt(t)` | `ClientBall::GetValueAt(Vector3*, Be::Time)` | interpolated position **minus the ego's interpolated position**, as **float32** components. Zero for the ego itself. For a non-free ball, `mNewPos` minus the ego's interpolated position. For a global ball, additionally divided by `mSomeWeirdHackToFixSomething` (default 1.0) | `D:src/Ball.cpp:1350-1426` |
| `GetVectorDotAt(t)` | `ClientBall::GetValueDotAt(Vector3*, Be::Time)` | the interpolated velocity `mLastVel` as float32, **not** relative to ego | `D:src/Ball.cpp:1438-1458` |
| `GetQuaternionAt(t)` | `ClientBall::GetValueAt(Quaternion*, Be::Time)` | smoothed yaw/pitch/roll as a quaternion; for a non-free ball always `(0,0,0,-1)` | `D:src/Ball.cpp:971-1091` |

The ego's own interpolated position is cached per time value in `Ballpark::GetReferencePoint`
(`D:src/Ballpark.cpp:3041-3066`).

### 7.3 Distance

There are three different distances in use, and they do not agree to the last metre.

| Use | Expression | Basis | Citation |
| --- | --- | --- | --- |
| `park.GetSurfaceDist(id1, id2)` | `(ball1->mNewPos - ball2->mNewPos).Length()-ball1->mRadius - ball2->mRadius` | tick state, double; can be negative; `None` if either ball is missing | `D:src/Thunkers.cpp:1798-1820` |
| `park.GetCenterDist(id1, id2)` | `(ball1->mNewPos - ball2->mNewPos).Length()` | tick state | `D:src/Thunkers.cpp:1774-1796` |
| `ball.surfaceDist` | `std::max(GetCenterDistance() - mRadius - egoBall->mRadius, 0.0)`; 0 for the ego or with no ego | cached interpolated centre distance from ego | `D:src/Ball.cpp:2102-2124` |
| overview row text | `ball.GetVectorAt(simTime).Length()` minus both radii, floored at 0 | interpolated, float32 vector | `C:eve/client/script/ui/inflight/overview/overviewScrollEntry.py:386-391` |

All are **surface to surface** (centre distance minus both radii).

The overview's sort value and raw distance are `max(ball.surfaceDist, 0)` taken right after a
`ball.GetVectorAt(now)` call (`C:eve/client/script/ui/inflight/overview/overviewWindow.py:1045-1046`).
The cache behind `surfaceDist`, `mCenterDist`, is refreshed as a side effect of interpolation:

- free balls: once per tick, on the first interpolation after the tick counter changes, as
  `(mLastPos - reference).Length()` in doubles (`D:src/Ball.cpp:1257-1259`, `:1300-1306`, `:885-902`);
- non-free balls: on each `GetValueAt` call, as the length of the **float32** relative vector
  (`D:src/Ball.cpp:1384-1401`);
- if it has never been set, `GetCenterDistance` falls back to the tick-state distance from the ego
  (`D:src/Ball.cpp:2115-2124`).

`Park.DistanceBetween` is `GetSurfaceDist` floored at 0 (`C:eve/client/script/remote/michelle.py:1033-1039`),
and `IsBallVisible` is `GetSurfaceDist(ego, id) < 50000000` (`:1616-1630`, `:34`). The autopilot uses
`bp.GetSurfaceDist(ship.id, destID)` and `destBall.surfaceDist` against `const.minWarpDistance`, which
is 150000 (`C:eve/client/script/parklife/autopilot.py:338`, `:545-566`;
`C:eve/common/lib/appConst.py:1480`).

### 7.4 Mode, speed fraction, speed

| Question | How the client asks | Citation |
| --- | --- | --- |
| mode | `ball.mode`, an integer from 1.2, compared with `destiny.DSTBALL_*` | `D:src/Ball_Blue.cpp:336-343` |
| in warp (either phase) | `ball.mode == destiny.DSTBALL_WARP` | `C:eve/client/script/remote/michelle.py:433-435` |
| preparing to warp | `ball.mode == destiny.DSTBALL_WARP and ball.effectStamp < 0` | `:429-431` |
| orbit target | `ball.followId` when `ball.mode == 4` | `:1398-1404` |
| approaching X | `ship.mode == destiny.DSTBALL_FOLLOW and ship.followId == destID` | `C:eve/client/script/parklife/autopilot.py:399` |
| speed fraction | `ball.speedFraction` (the float32 value widened to a Python float) | `D:src/Ball_Blue.cpp:327-333` |
| current speed | `ball.GetVectorDotAt(simTime).Length()` | `C:eve/client/script/ui/inflight/shipHud/activeShipController.py:167` |
| top speed | `ball.maxVelocity` | `:179` |
| overview velocity | `ball.GetVectorDotAt(simTime).Length()`; radial and transversal from the tick-state `x,y,z,vx,vy,vz` of the two balls | `C:eve/client/script/ui/inflight/overview/overviewNodeUtil.py:86-108` |

There is no "speed as a fraction of maximum" readout in the engine other than the commanded
`speedFraction`; actual speed over `maxVelocity` is computed by the caller.

---

## 8. Test material

Repo: `D:`. The Python tests build a park with `destiny.Ballpark()`, which leaves `isMaster` false, so
they exercise the client-side configuration. The standard test ball is `create_space_ball`
(`D:python/destiny/test/helpers.py:207-231`): free, massive, `maxVelocity` 10.0, `Agility` 0.9, mass
13000000.0, radius 2.0, `speedFraction` 0.95, ids from a counter starting at 1. Comparisons of
positions are to 4 decimal places (`helpers.py:129`), but the expected values are printed to full
precision and can be used for exact comparison (0.2).

### 8.1 Per-tick numeric sequences

| File | Test | Covers | Ticks |
| --- | --- | --- | --- |
| `python/destiny/test/ballpark/evolve/test_goto.py:10-34` | `test_goto_direction` | GOTO toward a far point | 10 positions |
| `:36-68` | `test_goto_point` | GOTO to a near point, overshoot and homing | 18 positions |
| `python/destiny/test/ballpark/evolve/test_follow.py:76-101` | `test_follow_stopped_ball` | FOLLOW, default range 1.0 | 10 |
| `:103-129` | `test_follow_moving_ball` | FOLLOW a ball that is itself in GOTO | 10 |
| `:16-42`, `:44-72` | `TestFormation` | FORMATION; depends on leader orientation | 10 each |
| `python/destiny/test/ballpark/evolve/test_stop.py:15-42` | `test_stop_ball_in_goto_mode` | STOP: **velocities**, shows the Y-damping | 10 |
| `python/destiny/test/ballpark/evolve/test_orbit.py:10-36` | `TestOldOrbit.test_orbit_ball` | old-style ORBIT; ids 1 and 2 matter | 10 |
| `python/destiny/test/ballpark/evolve/test_warp.py:12-41` | `test_warpto` | warp **alignment** only (10 ticks, never leaves it) | 10 |
| `python/destiny/test/ballpark/evolve/test_simple_collision.py:11-50` | `test_stopped_balls_with_same_location` | two balls at one point pushed apart | 10, both balls |
| `:53-92` | `test_stopped_balls_intersecting` | overlapping balls | 10, both |
| `:94-156` | `test_goto_collision` | head-on free-free bounce | 20, both |
| `:177-296` | `TestSimpleCapsuleCollision` (4 tests) | ball against a mini-capsule from four sides | 20 each |
| `:299-476` | `TestSimpleBoxCollision` (6 tests) | ball against a mini-box from six sides | 20 each |

### 8.2 Single values and byte strings

| File | What |
| --- | --- |
| `python/destiny/test/ballpark/test_stream_read_write.py:12`, `:65` | the two 5-byte empty packets (2.3) |
| `python/destiny/test/ballpark/test_stream_read_write.py:14-58`, `:67-75` | write-then-read round trips for a ball, a miniball, a mini-capsule, a mini-box. No expected bytes, but they define which attributes must survive (`helpers.py:83-122`) |
| `python/destiny/test/ballpark/test_movement_controls.py:79-87` | `WarpTo` stores `minRange` as raw double bits in `followId` and the factor in `ownerId` |
| `:89-96` | `WarpTo` to a near point becomes GOTO |
| `:111-186` | `GotoDirection`: goto point is exactly `1e17` along each axis; `(1,1,1)` gives `5.7735026918962584e+16` |
| `:44-49` | missile follow range is minus the sum of radii |
| `:307-343` | `LaunchMissile` initial velocities: `-150` on z from a stationary owner, `-1234` with a faster owner, `(250,0,0)` from an owner moving at 100, `(1,0,0)` aimed |
| `:365-371` | `EntityWarpIn` velocity is one AU per second |
| `python/destiny/test/ballpark/test_getters_and_setters.py:98-104` | `SetBallVelocity(1,2,3)` gives yaw `0.3217505543966422`, pitch `-0.5639426413606289` |
| `:168-280` | `GetAccuracy`: 1.0, 0.5, `0.46392604883716854`, `0.17762729659881724` |
| `:53-66` | `SetSpeedFraction` clamps to [0,1] |
| `python/destiny/test/ballpark/test_lifecycle_management.py:219-238` | mushroom radius per tick: 0, `6.687403202056885`, `7.952707290649414`, `8.801117897033691`, `9.457415580749512` |
| `python/destiny/test/test_ball.py:73-112` | every default of a new `Ball` (matches 1.4; `formationID` reads as 255) |
| `python/destiny/test/ballpark/evolve/test_missile.py:34-118` | missile end velocities after 20 ticks, to 2-4 places |

### 8.3 Behavioural tests with no exact numbers

| File | What |
| --- | --- |
| `python/destiny/test/net/client/test_ticker.py:52-124` | the history queue and the wait / fast-forward / rewind rules of 3.5 against a real park: `SetState` adopts the blob's tick (`:52-55`), a future update waits (`:64-70`), a late one rewinds (`:72-79`), rewind limits (`:86-108`), desync reporting (`:110-124`) |
| `python/destiny/test/net/client/test_mergestateintohistory.py` | eleven cases of the merge in 3.4 |
| `python/destiny/test/ballpark/evolve/test_orbit.py:39-184` | new-style orbit; tolerances only |
| `python/destiny/test/ballpark/evolve/test_iterative_collision.py` | iterative collision path; not the default |
| `python/destiny/test/ballpark/evolve/test_minis.py:89-131` | miniball collision keeps the ball outside, loosely |
| `python/destiny/test/ballpark/test_movement_controls.py` (rest), `test_getters_and_setters.py` (rest), `test_visibility.py`, `test_callbacks.py` | preconditions and side effects of each command; cloak makes a ball non-massive; sensors |
| `python/destiny/test/ballpark/test_boxes_and_bubbles.py`, `test_lifecycle_management.py:44-183` | partition boxes, range queries, bubbles (server side) |
| `python/destiny/test/net/server/*.py` | the server library: which action produces which entry, batching, `waitForBubble` |

The C++ unit tests (`D:tests/TestCollision.cpp`, `TestBoxShape.cpp`, `TestAABB.cpp`, `TestTriangle.cpp`,
`TestVector3d.cpp`) cover the geometry helpers used by box and capsule collision. There is no test
with expected numbers for warp cruise or deceleration, for interpolation, or for the tick driver.

`D:Equations.mws` is a Maple worksheet at the repo root, presumably the derivation of the integrator;
it was not opened.

---

## 9. Smallest correct port

**This whole section is judgement, not a finding.** The findings it rests on are cited above.

The aim is a client that observes: overview distances, own-ship flight state, and autopilot (warp,
approach, orbit, dock, jump). "Correct" here means the same tick-state positions as the retail client.

### 9.1 Needed

| Piece | Why |
| --- | --- |
| The blob reader, all of section 2, every mode tail and all three mini-shape lists | A record you cannot size correctly corrupts everything after it. Mini-shape bytes must at least be skipped |
| `AddBall` semantics including the create-versus-update difference (2.8) and follow-pointer resolution | An `AddBalls2` for a ball you already have is an update, not a replace |
| Ball fields of 1.4 except orientation and sensors; float32 storage for the five `float` fields | 4.4 |
| `Integrate` exactly as written; `SetBallTimeFactor`; `GotoThrust` | Every moving ball |
| Modes STOP (with the Y-damping), GOTO, FOLLOW, ORBIT old style, WARP in full | These are what approach, orbit, align, warp and coasting to a halt consist of |
| `Stop`, `StopAllFollowers`, and the transition rules of 4.9 | A ball being removed, cloaking or entering warp changes what its followers do |
| Every state setter in 6.5 | They arrive whenever a module changes mass, agility, speed or radius |
| `RemoveBall` with moribund state | Followers of a removed ball change mode at that moment |
| Loop order: ascending id, three passes, the in-loop side effects of 4.2 | They change results |
| The queue, defer / fast-forward / rewind, and snapshots (3.4-3.6), including that every blob read sets the tick | Without the rewind a late update is applied at the wrong tick and every position after it differs |
| A snapshot that restores exactly what the blob carries and nothing more | The retail client's rewind is lossy in specific ways (2.8); a perfect rewind would differ from it |
| Interpolation by re-integration with the two-tick shift (7.1) | Needed for anything shown between ticks, and for `surfaceDist` |

### 9.2 Can be left out, and what would make each matter

| Left out | Safe because | Starts to matter when |
| --- | --- | --- |
| Dynamical orientation, `ApplyTorque`, `GotoTorque*`, `GotoRoll*` | off by default (0.1) | the retail flag is on; then the blob layout changes too, which would show immediately as garbage |
| New-style orbit | off by default | the retail flag is on; an orbiting ship would drift from the old-style prediction within a few ticks. Worth one recorder comparison early |
| Iterative collision | off by default | the retail flag is on |
| Yaw, pitch, roll (`CalculateYawPitchRoll`, the quaternion interpolation) | Positions do not read them in GOTO, FOLLOW, ORBIT, STOP or WARP | you draw ship facing; FORMATION mode is used; a missile is launched from a stationary ship (its direction is the launcher's facing); or you want to send the same `CmdGotoDirection` the retail client sends when speed is raised from a stop, which uses the ship's current facing (`C:eve/client/script/ui/inflight/shipHud/activeShipController.py:220-225`) |
| Collisions (all of section 5) | Two balls that never touch are unaffected | **any** massive ball overlaps or reaches another within a tick: bumping a station or gate on approach, undocking into a crowd, ships orbiting the same wreck. For an autopilot that approaches and docks, this is the first omission likely to show. Until it is ported, positions near large fixed objects should be treated as approximate |
| The partition | With at most one collider per ball per tick the broad phase does not change the result | a ball has two or more colliders in one tick; then the visiting order decides which response is kept (5.2 step 5) |
| Miniballs, capsules, boxes as colliders | same as collisions | same as collisions; but their bytes must still be parsed |
| MISSILE mode | missiles are not on the overview by default and are non-massive unless launched massive | you show missiles, or a massive missile hits something you track |
| TROLL, MUSHROOM, FIELD, BOID, RIGID, FORMATION behaviour | rare or motionless | the server uses them near you: a TROLL ball coasts and then freezes, a FIELD ball is a force-field collider, a MUSHROOM is an expanding collider |
| Bubbles, interactive counts, keep-alives | master only (5.4) | never on a client |
| Proximity sensors, notification range, target tracking | events only | you want the events |
| Mode-change, warp and collision events | events only | UI effects |
| `mCenterDist` caching rules | you can compute distance directly | you want the overview's exact number, which lags by up to a tick for free balls and is float32 for fixed ones (7.3) |

### 9.3 Risks that are not about scope

- **Transcendental functions.** `exp`, `log`, `sin`, `cos` in JavaScript may differ from the C runtime
  in the last bit. The old orbit truncates to 7 decimals, which hides it almost always. `mTimeFactor`
  and warp do not hide it. A one-bit difference in `mTimeFactor` changes every later position of that
  ball in the last digits; it will not grow into metres, but it is not "the same positions".
  Measuring this needs a fixture generated by the real DLL across many masses and agilities.
- **Tick agreement.** Old-style orbit and warp both read `mCurrentTime`. A client that is one tick off
  computes a different orbital plane. The tick comes only from blob stamps and the rules of 3.5.
- **Phase.** The retail client's displayed position depends on when its own first tick fell (3.2).
  Two correct clients show the same tick states at different wall-clock moments. Compare tick states,
  not screen positions.

---

## 10. Everything marked NOT DETERMINED

| # | What | Where discussed |
| --- | --- | --- |
| 1 | The values of `g_useDynamicalOrientation`, `g_useNewOrbit`, `g_useIterativeCollision` in the retail binary. Indirect evidence says dynamical orientation is off; nothing either way for the other two | 0.1 |
| 2 | Whether the open-source revision is the one compiled into build 3396210 | 0.1 |
| 3 | Member order inside the float32 `Quaternion` (only matters with dynamical orientation on) | 2.4 |
| 4 | The engine's `OnTick` calling cadence | 3.2 |
| 5 | How `PyOS->SendEvent` reaches `Park.DoPreTick`/`DoPostTick`, and how `_parent_<name>` resolves to a C++ method (Blue internals) | 3.2, 6.3 |
| 6 | Floating-point compiler flags of the retail build (no `/fp:` or `/arch:` in the open-source CMake; fixtures reproduce without fused multiply-add) | 4.4 |
| 7 | Whether JavaScript `Math.exp`/`log`/`sin`/`cos` round as the retail C runtime does | 4.4, 9.3 |
| 8 | Whether the game server corrects clients after collisions | 5.5 |
| 9 | The exact names and argument values the retail game server sends | 6.6 |
| 10 | The mapping of Python `GetVectorAt`/`GetVectorDotAt`/`GetQuaternionAt` to the C++ `GetValueAt`/`GetValueDotAt` (Trinity interface exposure) | 7.2 |
| 11 | The definition of `TimeAsDouble` (inferred to return seconds) | 7.1 |
| 12 | How `ball.GetTotalDestructionEffectTime()` computes the removal delay (client graphics code, not examined) | 6.4 |
| 13 | What `remoteBallpark.UpdateStateRequest()` causes the server to send | 3.5 |

Not examined at all: `D:Equations.mws`, `D:destinyI.dll`, the contents of slim items and of the
`SetState` bag beyond the attribute names `Park.SetState` reads, and the `blue.marshal` format of a
`PackagedAction`.
