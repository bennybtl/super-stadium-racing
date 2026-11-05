/**
 * Opt-in shader-compile logger for chasing mid-race hitches. Enable from the
 * console, then reload and race:
 *
 *   localStorage.setItem('offroad:logEffects', '1')
 *
 * (remove the key to turn it off). Every effect Babylon creates is logged with
 * the time the frame was in the call (sync cost), the time until the program
 * was actually ready, and the defines that made it a distinct variant — so a
 * stutter can be matched to the material and the lights that caused it.
 * Wraps the engine's createEffect once; a no-op when the flag is unset.
 */
export function installEffectLog(engine) {
  let on = false;
  try { on = localStorage.getItem('offroad:logEffects') === '1'; } catch { /* storage blocked */ }
  if (!on || engine.__effectLogInstalled) return;
  engine.__effectLogInstalled = true;

  const t0 = performance.now();
  const orig = engine.createEffect.bind(engine);
  // createEffect is called again whenever a material re-evaluates its defines,
  // and Babylon answers from its cache — so log only effects not seen before,
  // and keep per-shader call counts in window.__effectCalls (a cache-hit storm
  // means something is dirtying defines every frame).
  const seen = new WeakSet();
  const calls = (window.__effectCalls = {});
  engine.createEffect = (baseName, options, ...rest) => {
    const start = performance.now();
    const effect = orig(baseName, options, ...rest);
    const key = typeof baseName === 'string' ? baseName : (baseName?.vertex ?? baseName?.fragment ?? '?');
    calls[key] = (calls[key] ?? 0) + 1;
    if (seen.has(effect)) return effect;
    seen.add(effect);
    const syncMs = performance.now() - start;
    const name = typeof baseName === 'string' ? baseName : (baseName?.vertex ?? baseName?.fragment ?? '?');
    const defines = String(options?.defines ?? '').split('\n').filter(Boolean);
    const lights = defines.filter((d) => /LIGHT\d|SHADOW\d/.test(d)).length;
    const report = () => {
      console.log(
        `[effect] +${((start - t0) / 1000).toFixed(1)}s ${name} sync ${syncMs.toFixed(1)}ms, ` +
        `ready ${(performance.now() - start).toFixed(0)}ms, ${defines.length} defines (${lights} light/shadow)`,
        defines
      );
    };
    if (effect.isReady?.()) report();
    else effect.onCompileObservable?.addOnce?.(report);
    return effect;
  };
  console.info('[effect] compile logging on (localStorage offroad:logEffects)');
}
