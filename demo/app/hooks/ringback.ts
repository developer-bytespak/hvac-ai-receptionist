/**
 * A ringback tone for the browser call.
 *
 * A web call connects in silence, and the agent waits a moment before its
 * opening line so the first words are not lost while the audio path opens.
 * Without a sound in that gap it reads as lag. With the North American
 * ringback (440 Hz and 480 Hz together, on and off) it reads as a phone
 * call being answered, which is what it is.
 *
 * Must be started from a user gesture, which the call button provides.
 */
export type Ringback = { stop: () => void };

export function startRingback(): Ringback | null {
  if (typeof window === "undefined") return null;
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;

  let ctx: AudioContext;
  try {
    ctx = new Ctx();
  } catch {
    return null;
  }

  const master = ctx.createGain();
  master.gain.value = 0.045;
  master.connect(ctx.destination);

  const gate = ctx.createGain();
  gate.gain.value = 0;
  gate.connect(master);

  const oscs: OscillatorNode[] = [];
  for (const hz of [440, 480]) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = hz;
    osc.connect(gate);
    osc.start();
    oscs.push(osc);
  }

  // Ring for 1.4s, rest for 0.9s, until stopped.
  const ON = 1.4;
  const OFF = 0.9;
  let t = ctx.currentTime + 0.05;
  let timer: number | undefined;
  const schedule = () => {
    for (let i = 0; i < 4; i++) {
      gate.gain.setTargetAtTime(1, t, 0.015);
      gate.gain.setTargetAtTime(0, t + ON, 0.02);
      t += ON + OFF;
    }
    timer = window.setTimeout(schedule, (ON + OFF) * 3 * 1000);
  };
  schedule();
  void ctx.resume();

  let stopped = false;
  // Whatever happens upstream, a ring never outlives the pick-up.
  const cap = window.setTimeout(() => stop(), 12_000);
  const stop = () => {
      if (stopped) return;
      stopped = true;
      if (timer) window.clearTimeout(timer);
      window.clearTimeout(cap);
      const now = ctx.currentTime;
      gate.gain.cancelScheduledValues(now);
      gate.gain.setTargetAtTime(0, now, 0.02);
      window.setTimeout(() => {
        for (const o of oscs) {
          try {
            o.stop();
          } catch {
            /* already stopped */
          }
        }
        void ctx.close().catch(() => undefined);
      }, 150);
  };
  return { stop };
}
